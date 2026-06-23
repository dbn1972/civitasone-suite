#!/bin/bash
# Creates all SQS queues needed by CivitasOne services.
# Runs after LocalStack is ready. awslocal is pre-installed in the LocalStack image.
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-ap-south-1}"

echo "[civitasone-init] Creating SQS queues..."

# One queue per service command topic (topic naming: {service}.{entity}.{verb})
QUEUES=(
  # tenant-service
  "tenant-tenant-create"
  "tenant-tenant-update"
  "tenant-tenant-activate"
  "tenant-tenant-archive"
  "tenant-orgunit-create"
  "tenant-orgunit-update"
  "tenant-settings-update"

  # identity-service
  "identity-user-create"
  "identity-user-update"
  "identity-user-deactivate"
  "identity-session-revoke"

  # policy-service
  "policy-role-create"
  "policy-role-update"
  "policy-binding-create"
  "policy-binding-revoke"

  # audit-service (receives events from all services)
  "audit-event-ingest"

  # notification-service
  "notification-send"

  # finance-service
  "finance-budget-create"
  "finance-budget-update"
  "finance-gl-post"

  # procurement-service
  "procurement-pr-create"
  "procurement-po-create"
  "procurement-po-approve"
  "procurement-grn-create"
)

for q in "${QUEUES[@]}"; do
  dlq="${q}-dlq"

  # 1. Create the DLQ first (idempotent: create-queue returns the existing
  #    URL if the queue already exists, so re-runs are safe).
  awslocal sqs create-queue --queue-name "$dlq" --region "$REGION" \
    --output text --query 'QueueUrl' >/dev/null 2>&1 \
    && echo "  created: $dlq" || echo "  exists:  $dlq"

  # 2. Create the main queue (idempotent for the same reason).
  awslocal sqs create-queue --queue-name "$q" --region "$REGION" \
    --output text --query 'QueueUrl' >/dev/null 2>&1 \
    && echo "  created: $q" || echo "  exists:  $q"

  # 3. Resolve the DLQ ARN and attach a RedrivePolicy (maxReceiveCount=5) to
  #    the main queue. set-queue-attributes is idempotent — re-applying the
  #    same policy is a no-op. Mirrors the Terraform sqs module defaults.
  dlq_url="$(awslocal sqs get-queue-url --queue-name "$dlq" --region "$REGION" \
    --output text --query 'QueueUrl')"
  dlq_arn="$(awslocal sqs get-queue-attributes --queue-url "$dlq_url" \
    --attribute-names QueueArn --region "$REGION" \
    --output text --query 'Attributes.QueueArn')"

  redrive_policy="{\"deadLetterTargetArn\":\"${dlq_arn}\",\"maxReceiveCount\":\"5\"}"
  main_url="$(awslocal sqs get-queue-url --queue-name "$q" --region "$REGION" \
    --output text --query 'QueueUrl')"
  awslocal sqs set-queue-attributes --queue-url "$main_url" --region "$REGION" \
    --attributes "{\"RedrivePolicy\":\"$(echo "$redrive_policy" | sed 's/"/\\"/g')\"}" \
    >/dev/null 2>&1 \
    && echo "  redrive: $q -> $dlq (maxReceiveCount=5)" \
    || echo "  redrive FAILED: $q"
done

echo "[civitasone-init] SQS queues ready."
