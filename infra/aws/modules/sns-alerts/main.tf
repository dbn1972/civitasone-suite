# SNS alerts module — one topic per environment, one optional email subscription.
# Wire this into every CloudWatch alarm that should page an operator.
# Set TF_VAR_alerts_email before running `terraform apply` to subscribe an
# email address; subscription requires manual confirmation from the inbox.

variable "environment" {
  description = "Deployment environment (e.g. production)."
  type        = string
}

variable "alerts_email" {
  description = "Email address to subscribe to alarm notifications. Set TF_VAR_alerts_email before applying. Subscription requires manual confirmation from inbox."
  type        = string
  default     = ""
}

resource "aws_sns_topic" "alerts" {
  name = "${var.environment}-civitasone-alerts"
  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Conditional subscription — created only when alerts_email is provided.
resource "aws_sns_topic_subscription" "email" {
  count     = var.alerts_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alerts_email
}

output "topic_arn" {
  value       = aws_sns_topic.alerts.arn
  description = "ARN of the SNS topic for CloudWatch alarm notifications."
}
