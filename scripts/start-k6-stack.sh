#!/usr/bin/env bash
# Start minimal stack for k6 baseline load test (gateway + hot read paths).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${ROOT}/.k6-stack-logs"
mkdir -p "$LOG_DIR"

export REDIS_URL="${REDIS_URL:-redis://localhost:6381}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-memory}"
export CACHE_DRIVER="${CACHE_DRIVER:-redis}"
export KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
export KEYCLOAK_REALM="${KEYCLOAK_REALM:-civitasone}"
export JWT_ALGORITHM="${JWT_ALGORITHM:-HS256}"
export JWT_SECRET="${JWT_SECRET:-test_secret_for_civitasone_32chr}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

start() {
  local name="$1"
  local dir="$2"
  local port="$3"
  shift 3
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo "[skip] ${name} already on :${port}"
    return
  fi
  echo "[start] ${name} on :${port}"
  (cd "$dir" && PORT="$port" "$@" >> "${LOG_DIR}/${name}.log" 2>&1) &
  echo $! > "${LOG_DIR}/${name}.pid"
}

start queue-service "${ROOT}/services/queue-service" 3030 \
  node dist/server.js

start finance-service "${ROOT}/services/finance-service" 3007 \
  env DATABASE_URL="postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance" \
  node dist/index.js

start citizen-service "${ROOT}/services/citizen-service" 3020 \
  env DATABASE_URL="postgres://citizen_svc:citizen_dev_pw@localhost:5435/civitas_citizen" \
  node dist/index.js

start hrms-service "${ROOT}/services/hrms-service" 3012 \
  env DATABASE_URL="postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms" \
  node dist/index.js

sleep 2
start gateway-service "${ROOT}/services/gateway-service" 8080 \
  node dist/index.js

echo "Waiting for /health..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    echo "Gateway ready."
    exit 0
  fi
  sleep 1
done
echo "Gateway failed to become ready — see ${LOG_DIR}/gateway-service.log"
exit 1
