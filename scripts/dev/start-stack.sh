#!/usr/bin/env bash
# start-stack.sh — starts every CivitasOne service on its registry port.
# All services log to /tmp/civitas-stack/<svc>.log  (backgrounded).
# Run stop-stack.sh to kill them.
#
# Usage: bash scripts/dev/start-stack.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="/tmp/civitas-stack"
PID_DIR="/tmp/civitas-stack/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# ── Common env for all services ───────────────────────────────────────────────
export REDIS_URL="${REDIS_URL:-redis://localhost:6381}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-memory}"
export CACHE_DRIVER="${CACHE_DRIVER:-redis}"
export JWT_ALGORITHM="${JWT_ALGORITHM:-HS256}"
export JWT_SECRET="${JWT_SECRET:-civitasone-dev-secret}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"
export NODE_ENV="development"
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

# ── Start helper ─────────────────────────────────────────────────────────────
start_svc() {
  local name="$1"
  local dir="$2"
  local port="$3"
  local main="$4"
  shift 4
  local extra_env=("$@")

  local pidfile="$PID_DIR/${name}.pid"

  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo "[skip ] ${name} already on :${port}"
    return
  fi

  echo "[start] ${name} on :${port}"
  (
    cd "$dir"
    env PORT="$port" "${extra_env[@]}" \
      node "$main" \
      >> "$LOG_DIR/${name}.log" 2>&1
  ) &
  echo $! > "$pidfile"
}

# ── Services ─────────────────────────────────────────────────────────────────
start_svc identity-service "$ROOT/services/identity-service"     3001 dist/index.js \
  DATABASE_URL="postgres://identity_svc:identity_dev_pw@localhost:5435/civitas_identity"

start_svc tenant-service   "$ROOT/services/tenant-service"       3002 dist/index.js \
  DATABASE_URL="postgres://tenant_svc:tenant_dev_pw@localhost:5435/civitas_tenant"

start_svc policy-service   "$ROOT/services/policy-service"       3003 dist/index.js \
  DATABASE_URL="postgres://policy_svc:policy_dev_pw@localhost:5435/civitas_policy"

start_svc audit-service    "$ROOT/services/audit-service"        3004 dist/index.js \
  DATABASE_URL="postgres://audit_svc:audit_dev_pw@localhost:5435/civitas_audit"

start_svc install-service  "$ROOT/services/install-service"      3005 dist/index.js \
  DATABASE_URL="postgres://install_svc:install_dev_pw@localhost:5435/civitas_install"

start_svc notification-service "$ROOT/services/notification-service" 3006 dist/index.js \
  DATABASE_URL="postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification"

start_svc finance-service  "$ROOT/services/finance-service"      3007 dist/index.js \
  DATABASE_URL="postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance"

start_svc procurement-service "$ROOT/services/procurement-service" 3008 dist/index.js \
  DATABASE_URL="postgres://procurement_svc:procurement_dev_pw@localhost:5435/civitas_procurement"

start_svc contract-service "$ROOT/services/contract-service"     3009 dist/index.js \
  DATABASE_URL="postgres://contract_svc:contract_dev_pw@localhost:5435/civitas_contract"

start_svc estab-service    "$ROOT/services/estab-service"        3010 dist/index.js \
  DATABASE_URL="postgres://estab_svc:estab_dev_pw@localhost:5435/civitas_estab"

start_svc stock-service    "$ROOT/services/stock-service"        3011 dist/index.js \
  DATABASE_URL="postgres://stock_svc:stock_dev_pw@localhost:5435/civitas_stock"

start_svc hrms-service     "$ROOT/services/hrms-service"         3012 dist/index.js \
  DATABASE_URL="postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms"

start_svc payroll-service  "$ROOT/services/payroll-service"      3013 dist/index.js \
  DATABASE_URL="postgres://payroll_svc:payroll_dev_pw@localhost:5435/civitas_payroll"

start_svc project-service  "$ROOT/services/project-service"      3014 dist/index.js \
  DATABASE_URL="postgres://project_svc:project_dev_pw@localhost:5435/civitas_project"

start_svc asset-service    "$ROOT/services/asset-service"        3015 dist/index.js \
  DATABASE_URL="postgres://asset_svc:asset_dev_pw@localhost:5435/civitas_asset"

start_svc report-service   "$ROOT/services/report-service"       3016 dist/index.js \
  DATABASE_URL="postgres://report_svc:report_dev_pw@localhost:5435/civitas_report"

start_svc plugin-service   "$ROOT/services/plugin-service"       3017 dist/index.js \
  DATABASE_URL="postgres://plugin_svc:plugin_dev_pw@localhost:5435/civitas_plugin"

start_svc theme-service    "$ROOT/services/theme-service"        3018 dist/index.js \
  DATABASE_URL="postgres://theme_svc:theme_dev_pw@localhost:5435/civitas_theme"

start_svc grant-service    "$ROOT/services/grant-service"        3019 dist/index.js \
  DATABASE_URL="postgres://grant_svc:grant_dev_pw@localhost:5435/civitas_grant"

start_svc citizen-service  "$ROOT/services/citizen-service"      3020 dist/index.js \
  DATABASE_URL="postgres://citizen_svc:citizen_dev_pw@localhost:5435/civitas_citizen"

start_svc legal-service    "$ROOT/services/legal-service"        3021 dist/index.js \
  DATABASE_URL="postgres://legal_svc:legal_dev_pw@localhost:5435/civitas_legal"

start_svc admin-service    "$ROOT/services/admin-service"        3022 dist/index.js \
  DATABASE_URL="postgres://admin_svc:admin_dev_pw@localhost:5435/civitas_admin"

start_svc billing-service  "$ROOT/services/billing-service"      3023 dist/index.js \
  DATABASE_URL="postgres://billing_svc:billing_dev_pw@localhost:5435/civitas_billing"

start_svc crm-service      "$ROOT/services/crm-service"          3024 dist/index.js \
  DATABASE_URL="postgres://crm_svc:crm_dev_pw@localhost:5435/civitas_crm"

start_svc inventory-service "$ROOT/services/inventory-service"   3025 dist/index.js \
  DATABASE_URL="postgres://inventory_svc:inventory_dev_pw@localhost:5435/civitas_inventory"

start_svc telephony-service "$ROOT/services/telephony-service"   3026 dist/index.js \
  DATABASE_URL="postgres://telephony_svc:telephony_dev_pw@localhost:5435/civitas_telephony"

start_svc helpdesk-service "$ROOT/services/helpdesk-service"     3027 dist/index.js \
  DATABASE_URL="postgres://helpdesk_svc:helpdesk_dev_pw@localhost:5435/civitas_helpdesk"

start_svc knowledge-service "$ROOT/services/knowledge-service"   3028 dist/index.js \
  DATABASE_URL="postgres://knowledge_svc:knowledge_dev_pw@localhost:5435/civitas_knowledge"

start_svc workflow-service "$ROOT/services/workflow-service"     3029 dist/index.js \
  DATABASE_URL="postgres://workflow_svc:workflow_dev_pw@localhost:5435/civitas_workflow"

start_svc queue-service    "$ROOT/services/queue-service"        3030 dist/server.js

start_svc analytics-service "$ROOT/services/analytics-service"  3031 dist/index.js \
  DATABASE_URL="postgres://analytics_svc:analytics_dev_pw@localhost:5435/civitas_analytics"

start_svc location-service "$ROOT/services/location-service"     4012 dist/index.js \
  DATABASE_URL="postgres://location_svc:location_dev_pw@localhost:5435/civitas_location"

# ── Gateway (last) ────────────────────────────────────────────────────────────
sleep 3
start_svc gateway-service  "$ROOT/services/gateway-service"      8080 dist/index.js

# ── Health check ──────────────────────────────────────────────────────────────
echo ""
echo "Waiting for gateway /health..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
echo "──────────────────────────────────────────────────────────"
printf "%-30s %-8s %s\n" "SERVICE" "PORT" "STATUS"
echo "──────────────────────────────────────────────────────────"

check_svc() {
  local name="$1"
  local port="$2"
  local path="${3:-/health}"
  local status
  if curl -sf "http://localhost:${port}${path}" >/dev/null 2>&1; then
    status="UP"
  else
    status="DOWN"
  fi
  printf "%-30s %-8s %s\n" "$name" "$port" "$status"
  if [ "$status" = "DOWN" ]; then
    # Print last few lines of log for debugging
    local logfile="$LOG_DIR/${name}.log"
    if [ -f "$logfile" ]; then
      echo "  [tail] $(tail -3 "$logfile" 2>/dev/null | tr '\n' ' ')"
    fi
  fi
}

check_svc identity-service     3001
check_svc tenant-service       3002
check_svc policy-service       3003
check_svc audit-service        3004
check_svc install-service      3005
check_svc notification-service 3006
check_svc finance-service      3007
check_svc procurement-service  3008
check_svc contract-service     3009
check_svc estab-service        3010
check_svc stock-service        3011
check_svc hrms-service         3012
check_svc payroll-service      3013
check_svc project-service      3014
check_svc asset-service        3015
check_svc report-service       3016
check_svc plugin-service       3017
check_svc theme-service        3018
check_svc grant-service        3019
check_svc citizen-service      3020
check_svc legal-service        3021
check_svc admin-service        3022
check_svc billing-service      3023
check_svc crm-service          3024
check_svc inventory-service    3025
check_svc telephony-service    3026
check_svc helpdesk-service     3027
check_svc knowledge-service    3028
check_svc workflow-service     3029
check_svc queue-service        3030
check_svc analytics-service    3031
check_svc location-service     4012
check_svc gateway-service      8080

echo "──────────────────────────────────────────────────────────"
echo "Logs: $LOG_DIR/"
echo "Stop: bash scripts/dev/stop-stack.sh"
