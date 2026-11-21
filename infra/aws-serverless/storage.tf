resource "aws_dynamodb_table" "app" {
  name           = local.name
  billing_mode   = var.billing_mode
  read_capacity  = var.billing_mode == "PROVISIONED" ? var.read_capacity : null
  write_capacity = var.billing_mode == "PROVISIONED" ? var.write_capacity : null
  dynamic "on_demand_throughput" {
    for_each = var.billing_mode == "PAY_PER_REQUEST" ? [1] : []
    content {
      max_read_request_units  = var.max_read_request_units
      max_write_request_units = var.max_write_request_units
    }
  }
  hash_key                    = "pk"
  range_key                   = "sk"
  stream_enabled              = true
  stream_view_type            = "NEW_AND_OLD_IMAGES"
  deletion_protection_enabled = true
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = false } # AWS-owned default encryption, no customer KMS key.
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket" "snapshots" {
  bucket        = "${local.name}-snapshots-${local.account_id}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "snapshots" {
  bucket                  = aws_s3_bucket.snapshots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.snapshots.arn, "${aws_s3_bucket.snapshots.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }] })
}
resource "aws_s3vectors_vector_bucket" "memories" {
  vector_bucket_name       = "${local.name}-vectors-${local.account_id}"
  force_destroy            = false
  encryption_configuration = [{ sse_type = "AES256", kms_key_arn = null }]
  lifecycle { prevent_destroy = true }
}
resource "aws_s3vectors_index" "memories" {
  vector_bucket_name = aws_s3vectors_vector_bucket.memories.vector_bucket_name
  index_name         = "memories-titan-v2-${var.embedding_dimensions}"
  data_type          = "float32"
  dimension          = var.embedding_dimensions
  distance_metric    = "cosine"
  lifecycle { prevent_destroy = true }
}
resource "aws_sqs_queue" "failures" {
  name                      = "${local.name}-worker-failures"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
