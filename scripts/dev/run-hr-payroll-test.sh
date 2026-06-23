#!/usr/bin/env bash
# Starts hrms/payroll/finance workers + restarts those APIs with SQS, runs integration test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="/tmp/civitas-stack"
PID_DIR="/tmp/civitas-stack/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

export QUEUE_DRIVER=sqs
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export JWT_SECRET="${JWT_SECRET:-civitasone-dev-secret}"
export JWT_ALGORITHM="${JWT_ALGORITHM:-HS256}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"

kill_port() {
  local port="$1"
  local stale
  stale=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
  if [ -n "$stale" ]; then kill "$stale" 2>/dev/null || true; sleep 0.3; fi
}

start_api() {
  local name="$1" dir="$2" port="$3" db_url="$4"
  kill_port "$port"
  echo "[api] ${name} :${port} (sqs)"
  (
    cd "$dir"
    env PORT="$port" DATABASE_URL="$db_url" QUEUE_DRIVER=sqs \
      node dist/index.js >> "$LOG_DIR/${name}.log" 2>&1
  ) &
  echo $! > "$PID_DIR/${name}.pid"
}

start_worker() {
  local name="$1" dir="$2" db_url="$3"
  local wpid="$PID_DIR/${name}-worker.pid"
  if [ -f "$wpid" ]; then
    old=$(cat "$wpid" 2>/dev/null || true)
    kill "$old" 2>/dev/null || true
  fi
  echo "[worker] ${name} (sqs)"
  (
    cd "$dir"
    env DATABASE_URL="$db_url" QUEUE_DRIVER=sqs HRMS_SERVICE_URL="http://127.0.0.1:3012" \
      PAYROLL_SERVICE_URL="http://127.0.0.1:3013" \
      node dist/worker.js >> "$LOG_DIR/${name}-worker.log" 2>&1
  ) &
  echo $! > "$wpid"
}

echo "=== Preparing SQS-backed HR/Payroll test environment ==="

start_worker hrms-service     "$ROOT/services/hrms-service"     "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms"
start_worker payroll-service  "$ROOT/services/payroll-service"  "postgres://payroll_svc:payroll_dev_pw@localhost:5435/civitas_payroll"
start_worker finance-service  "$ROOT/services/finance-service"  "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance"
start_worker workflow-service "$ROOT/services/workflow-service" "postgres://workflow_svc:workflow_dev_pw@localhost:5435/civitas_workflow"

start_api policy-service   "$ROOT/services/policy-service"   3003 "postgres://policy_svc:policy_dev_pw@localhost:5435/civitas_policy"
start_api hrms-service     "$ROOT/services/hrms-service"     3012 "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms"
start_api payroll-service  "$ROOT/services/payroll-service"  3013 "postgres://payroll_svc:payroll_dev_pw@localhost:5435/civitas_payroll"
start_api finance-service  "$ROOT/services/finance-service"  3007 "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance"
start_api workflow-service "$ROOT/services/workflow-service" 3029 "postgres://workflow_svc:workflow_dev_pw@localhost:5435/civitas_workflow"

echo "Waiting for services..."
for i in $(seq 1 20); do
  if curl -sf "http://localhost:3003/health" >/dev/null 2>&1 \
     && curl -sf "http://localhost:3012/health" >/dev/null 2>&1 \
     && curl -sf "http://localhost:3013/health" >/dev/null 2>&1 \
     && curl -sf "http://localhost:3029/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sleep 2

echo ""
node "$ROOT/scripts/dev/test-hr-payroll-flow.mjs"
exit $?
