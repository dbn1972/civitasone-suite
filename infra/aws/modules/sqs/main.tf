# QUE-2: SQS module — per-topic main queue + dead-letter queue with redrive,
# tuned visibility, and CloudWatch alarms on DLQ depth and oldest-message age.
# Mirrors the app-level safety net in queue-service/src/bus.ts so production has
# native broker-enforced dead-lettering, not just an application fallback.

variable "topics" {
  description = "List of queue topic base names (dots will be converted to dashes)."
  type        = list(string)
}

variable "environment" {
  description = "Deployment environment (e.g. production)."
  type        = string
}

variable "max_receive_count" {
  description = "Receives before a message is moved to the DLQ."
  type        = number
  default     = 5
}

variable "visibility_timeout_seconds" {
  description = "Must be >= the slowest consumer handler runtime."
  type        = number
  default     = 60
}

variable "message_retention_seconds" {
  description = "How long messages live in the main queue."
  type        = number
  default     = 345600 # 4 days
}

variable "dlq_retention_seconds" {
  description = "How long dead-lettered messages are retained for inspection."
  type        = number
  default     = 1209600 # 14 days
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN to notify on DLQ alarms (optional)."
  type        = string
  default     = ""
}

locals {
  # topic "finance.gl.post" -> queue "finance-gl-post"
  names = { for t in var.topics : t => replace(t, ".", "-") }
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.names
  name                      = "${each.value}-dlq"
  message_retention_seconds = var.dlq_retention_seconds
  tags = {
    Environment = var.environment
    Topic       = each.key
    Role        = "dead-letter"
  }
}

resource "aws_sqs_queue" "main" {
  for_each                   = local.names
  name                       = each.value
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = var.max_receive_count
  })
  tags = {
    Environment = var.environment
    Topic       = each.key
    Role        = "main"
  }
}

# Alarm: any message sitting in a DLQ is an operator-actionable event.
resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  for_each            = local.names
  alarm_name          = "${each.value}-dlq-not-empty"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq[each.key].name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Messages present in ${each.value}-dlq — a consumer is failing."
  alarm_actions       = var.alarm_sns_topic_arn == "" ? [] : [var.alarm_sns_topic_arn]
  ok_actions          = var.alarm_sns_topic_arn == "" ? [] : [var.alarm_sns_topic_arn]
}

# Alarm: main-queue backlog aging indicates stalled/absent consumers.
resource "aws_cloudwatch_metric_alarm" "main_age" {
  for_each            = local.names
  alarm_name          = "${each.value}-oldest-message-age"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.main[each.key].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 900 # 15 min
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Oldest message in ${each.value} older than 15m — consumer stalled."
  alarm_actions       = var.alarm_sns_topic_arn == "" ? [] : [var.alarm_sns_topic_arn]
}

output "queue_urls" {
  value = { for k, q in aws_sqs_queue.main : k => q.url }
}

output "dlq_urls" {
  value = { for k, q in aws_sqs_queue.dlq : k => q.url }
}
