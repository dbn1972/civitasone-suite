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
  awslocal sqs create-queue --queue-name "$q" --region "$REGION" \
    --output text --query 'QueueUrl' 2>/dev/null \
    && echo "  created: $q" || echo "  exists:  $q"
done

echo "[civitasone-init] SQS queues ready."
