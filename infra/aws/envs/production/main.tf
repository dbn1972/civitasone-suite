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

# QUE-2 / gap 05-T2: per-topic SQS main queue + DLQ with redrive, tuned
# visibility, and CloudWatch alarms. Topic list is kept in sync with
# infra/localstack-init/01-create-sqs-queues.sh so prod and local match.
module "sqs" {
  source      = "../../modules/sqs"
  environment = var.environment
  topics      = local.sqs_topics

  # Module defaults are sensible for production:
  #   max_receive_count = 5, visibility_timeout_seconds = 60,
  #   message_retention_seconds = 4d, dlq_retention_seconds = 14d.
  alarm_sns_topic_arn = var.alarm_sns_topic_arn
}

locals {
  # Service command topics — one queue per topic. Names are already in the
  # dash form the module expects (it also converts any dots to dashes).
  # MUST stay in sync with infra/localstack-init/01-create-sqs-queues.sh.
  sqs_topics = [
    # tenant-service
    "tenant-tenant-create",
    "tenant-tenant-update",
    "tenant-tenant-activate",
    "tenant-tenant-archive",
    "tenant-orgunit-create",
    "tenant-orgunit-update",
    "tenant-settings-update",

    # identity-service
    "identity-user-create",
    "identity-user-update",
    "identity-user-deactivate",
    "identity-session-revoke",

    # policy-service
    "policy-role-create",
    "policy-role-update",
    "policy-binding-create",
    "policy-binding-revoke",

    # audit-service (receives events from all services)
    "audit-event-ingest",

    # notification-service
    "notification-send",

    # finance-service
    "finance-budget-create",
    "finance-budget-update",
    "finance-gl-post",

    # procurement-service
    "procurement-pr-create",
    "procurement-po-create",
    "procurement-po-approve",
    "procurement-grn-create",
  ]
}

variable "aws_region" { default = "ap-south-1" }
variable "environment" { default = "production" }

# No SNS topic module is wired into this env yet, so this defaults to "" which
# the sqs module treats as "create alarms with no notification actions".
# Set this (e.g. via tfvars) once an alerting SNS topic exists.
variable "alarm_sns_topic_arn" {
  type    = string
  default = ""
}
