terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
  # Backend configured per environment via -backend-config flag
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

# Module composition — expand per sprint
# module "alb"          { source = "../../modules/alb" }
# module "ecs"          { source = "../../modules/ecs" }
# module "rds"          { source = "../../modules/rds" }
# module "elasticache"  { source = "../../modules/elasticache" }
# module "s3"           { source = "../../modules/s3" }
# module "sqs"          { source = "../../modules/sqs" }

variable "aws_region" { default = "ap-south-1" }
variable "environment" { default = "production" }
