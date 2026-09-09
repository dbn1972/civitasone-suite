#!/usr/bin/env bash
# PERF-010: minimal stack for the k6 perf suite -- extends
# scripts/start-k6-stack.sh's pattern (same non-PM2 direct `node dist/...`
# launch style used for isolated load-testing) to add identity-service,
# which that script didn't start and the token-validate / queue-publish k6
# targets both need.
#
# Requires the shared dev Postgres + Redis containers already running on
# this host (infra/docker-compose.yml -- civitasone-postgres:5435,
# civitasone-redis:6381) with civitas_identity/civitas_finance/civitas_hrms
# already bootstrapped (scripts/ci/bootstrap-postgres.sh). Does not touch
# any other worktree's processes -- ports below are only bound if free.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${ROOT}/.perf-stack-logs"
mkdir -p "$LOG_DIR"

export REDIS_URL="${REDIS_URL:-redis://localhost:6381}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-memory}"
export CACHE_DRIVER="${CACHE_DRIVER:-redis}"
export JWT_ALGORITHM="${JWT_ALGORITHM:-HS256}"
export JWT_SECRET="${JWT_SECRET:-civitasone-dev-secret}"
export LOG_LEVEL="${LOG_LEVEL:-error}"
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5435}"

start() {
  local name="$1" dir="$2" port="$3"
  shift 3
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo "[skip] ${name} already on :${port}"
    return
  fi
  echo "[start] ${name} on :${port}"
  (cd "$dir" && PORT="$port" "$@" >> "${LOG_DIR}/${name}.log" 2>&1) &
  echo $! > "${LOG_DIR}/${name}.pid"
}

start identity-service "${ROOT}/services/identity-service" 3001 \
  env DATABASE_URL="postgres://identity_svc:identity_dev_pw@${PGHOST}:${PGPORT}/civitas_identity" \
  node dist/index.js

start finance-service "${ROOT}/services/finance-service" 3007 \
  env DATABASE_URL="postgres://finance_svc:finance_dev_pw@${PGHOST}:${PGPORT}/civitas_finance" \
  node dist/index.js

start hrms-service "${ROOT}/services/hrms-service" 3012 \
  env DATABASE_URL="postgres://hrms_svc:hrms_dev_pw@${PGHOST}:${PGPORT}/civitas_hrms" \
  node dist/index.js

sleep 2
start gateway-service "${ROOT}/services/gateway-service" 8080 \
  node dist/index.js

echo "Waiting for services to become healthy..."
for svc_port in identity:3001 finance:3007 hrms:3012 gateway:8080; do
  name="${svc_port%%:*}"; port="${svc_port##*:}"
  ok=0
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done
  if [ "$ok" -eq 1 ]; then
    echo "  ${name} ready on :${port}"
  else
    echo "  ${name} failed to become ready on :${port} -- see ${LOG_DIR}/${name}.log"
    exit 1
  fi
done

echo "Perf stack ready."
