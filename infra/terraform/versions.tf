terraform {
  required_version = ">= 1.17.0, < 2.0.0"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "= 5.28.1" }
    aws        = { source = "hashicorp/aws", version = "= 6.72.0" }
  }
  backend "s3" {}
}
provider "cloudflare" {}
provider "aws" { region = var.aws_region }
