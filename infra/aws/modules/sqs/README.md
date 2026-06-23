# SQS module (QUE-2)

Provisions, per topic, a main queue + dead-letter queue with:
- `RedrivePolicy` (`maxReceiveCount`, default 5) → poison messages dead-letter natively
- tuned `visibility_timeout_seconds` (default 60, set ≥ slowest handler)
- message retention (main 4d, DLQ 14d)
- CloudWatch alarms: DLQ-not-empty (period 60s) and oldest-message-age > 15m

This mirrors the application-level safety net in
`services/queue-service/src/bus.ts` (`getOrCreateQueue` sets the same RedrivePolicy
at runtime; `pollTopic` dead-letters after `SQS_MAX_RECEIVE_COUNT`). With this
module deployed, dead-lettering is enforced by the broker and observable via alarms.

## Usage (enable in production)
```hcl
module "sqs" {
  source              = "../../modules/sqs"
  environment         = "production"
  topics              = local.queue_topics   # full list from services/*/src/topics.ts
  alarm_sns_topic_arn = aws_sns_topic.ops_alerts.arn
}
```
Then uncomment the `module "sqs"` block in `infra/aws/envs/production/main.tf`.

## Runtime env (consumed by queue-service)
- `SQS_MAX_RECEIVE_COUNT` (default 5) — keep in sync with `max_receive_count`
- `SQS_VISIBILITY_TIMEOUT` (default 60) — keep in sync with `visibility_timeout_seconds`
