#!/bin/bash
# Creates the S3 bucket(s) needed by CivitasOne services (DOM-006).
# Runs after LocalStack is ready. awslocal is pre-installed in the LocalStack image.
#
# LocalStack's `SERVICES: sqs,s3` env var (docker-compose.prod.yml) enables the
# S3 service but never created a bucket for it — @civitasone/storage and every
# real upload path (attachments, form16 PDFs, CRM documents, ...) default to
# bucket AWS_S3_BUCKET (default: civitasone) and simply got PUT/GET failures
# against a nonexistent bucket in any environment that actually exercised them.
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
BUCKET="${AWS_S3_BUCKET:-civitasone}"

echo "[civitasone-init] Creating S3 bucket..."

awslocal s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration "LocationConstraint=$REGION" \
  >/dev/null 2>&1 \
  && echo "  created: $BUCKET" \
  || echo "  exists:  $BUCKET"

echo "[civitasone-init] S3 bucket ready."
