resource "aws_cloudwatch_log_group" "runtime" {
  for_each          = toset(["api", "worker"])
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 7
}
resource "aws_lambda_function" "runtime" {
  for_each                       = toset(["api", "worker"])
  function_name                  = "${local.name}-${each.key}"
  role                           = aws_iam_role.runtime[each.key].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["arm64"]
  handler                        = each.key == "api" ? "dist/aws-handler.handler" : "dist/aws-worker.handler"
  filename                       = var.lambda_zip
  source_code_hash               = filebase64sha256(var.lambda_zip)
  memory_size                    = 512
  timeout                        = each.key == "api" ? 29 : 120
  reserved_concurrent_executions = each.key == "api" ? var.api_concurrency : var.worker_concurrency
  environment { variables = merge(local.common_env, each.key == "api" && var.enable_cloudfront ? { PENSIEVE_EDGE_TOKEN = random_password.edge[0].result } : {}) }
  depends_on = [aws_iam_role_policy.runtime, aws_cloudwatch_log_group.runtime]
}
resource "aws_lambda_event_source_mapping" "work" {
  event_source_arn                   = aws_dynamodb_table.app.stream_arn
  function_name                      = aws_lambda_function.runtime["worker"].arn
  starting_position                  = "TRIM_HORIZON"
  enabled                            = var.enable_workers
  batch_size                         = 1
  maximum_batching_window_in_seconds = 1
  bisect_batch_on_function_error     = true
  maximum_retry_attempts             = 10
  maximum_record_age_in_seconds      = 86400
  function_response_types            = ["ReportBatchItemFailures"]
  destination_config {
    on_failure { destination_arn = aws_sqs_queue.failures.arn }
  }
  filter_criteria {
    filter { pattern = jsonencode({ eventName = ["INSERT", "MODIFY"], dynamodb = { NewImage = { pk = { S = [for prefix in ["USER#", "POOL#", "SHARE#", "DELIVERY#", "SESSION#", "BATCH#"] : { prefix = prefix }] } } } }) }
  }
  depends_on = [aws_iam_role_policy.runtime]
}
resource "aws_apigatewayv2_api" "app" {
  name          = local.name
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "app" {
  api_id                 = aws_apigatewayv2_api.app.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.runtime["api"].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}
resource "aws_apigatewayv2_route" "app" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.app.id}"
}
resource "aws_apigatewayv2_stage" "app" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
}
resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.runtime["api"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.app.execution_arn}/*/*"
}
resource "aws_cloudwatch_metric_alarm" "worker_failures" {
  alarm_name          = "${local.name}-worker-failures"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.failures.name }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 1
  statistic           = "Maximum"
  treat_missing_data  = "notBreaching"
}
resource "aws_budgets_budget" "app" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$pensieve"]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_emails
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_emails
  }
}

# Streams expire after 24 hours. The durable keyed work ledger is the recovery source.
resource "aws_cloudwatch_event_rule" "reconcile" {
  name                = "${local.name}-reconcile"
  description         = "Recover bounded durable indexing and delivery work without scanning."
  schedule_expression = "rate(1 hour)"
  state               = var.enable_workers ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "reconcile" {
  rule      = aws_cloudwatch_event_rule.reconcile.name
  target_id = "worker"
  arn       = aws_lambda_function.runtime["worker"].arn
  input     = jsonencode({ kind = "reconcile" })
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 2
  }
  dead_letter_config { arn = aws_sqs_queue.failures.arn }
  depends_on = [aws_sqs_queue_policy.failures]
}
resource "aws_lambda_permission" "reconcile" {
  statement_id  = "AllowReconciliationSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.runtime["worker"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reconcile.arn
}
resource "aws_sqs_queue_policy" "failures" {
  queue_url = aws_sqs_queue.failures.url
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "EventBridgeFailedReconciliation"
    Effect    = "Allow"
    Principal = { Service = "events.amazonaws.com" }
    Action    = "sqs:SendMessage"
    Resource  = aws_sqs_queue.failures.arn
    Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.reconcile.arn } }
  }] })
}
