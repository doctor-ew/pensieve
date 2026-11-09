resource "aws_iam_role" "runtime" {
  for_each           = toset(["api", "worker"])
  name               = "${local.name}-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "runtime" {
  for_each = aws_iam_role.runtime
  role     = each.value.id
  name     = "runtime"
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.runtime[each.key].arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem"], Resource = aws_dynamodb_table.app.arn },
    { Effect = "Allow", Action = each.key == "api" ? ["s3:GetObject", "s3:PutObject"] : ["s3:GetObject"], Resource = "${aws_s3_bucket.snapshots.arn}/*" },
    { Effect = "Allow", Action = ["bedrock:InvokeModel"], Resource = "${local.arn_prefix}:bedrock:${var.aws_region}::foundation-model/${var.embedding_model}" },
    { Effect = "Allow", Action = ["ses:SendEmail"], Resource = var.ses_identity_arn, Condition = { StringEquals = { "ses:FromAddress" = var.sender_email } } }
    ], each.key == "api" ? [
    { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = "${local.arn_prefix}:ssm:${var.aws_region}:${local.account_id}:parameter${var.owner_token_parameter}" },
    { Effect = "Allow", Action = ["s3vectors:QueryVectors", "s3vectors:GetVectors"], Resource = aws_s3vectors_index.memories.index_arn }
    ] : [
    { Effect = "Allow", Action = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"], Resource = aws_dynamodb_table.app.stream_arn },
    { Effect = "Allow", Action = ["dynamodb:ListStreams"], Resource = "*" },
    { Effect = "Allow", Action = ["s3vectors:PutVectors"], Resource = aws_s3vectors_index.memories.index_arn },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.failures.arn }
  ]) })
}
