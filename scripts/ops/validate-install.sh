#!/usr/bin/env bash
# CivitasOne — Post-install validation & adapter pre-flight check
# Aligned to: Volume 6 Section 6 (Post-install validation and readiness checks)
# Usage: ./scripts/ops/validate-install.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-civitasone}"

PASS=0
FAIL=0
WARN=0

check() {
  local desc="$1" result="$2"
  if [ "$result" = "PASS" ]; then
    printf "${GREEN}✓${NC} %s\n" "$desc"
    ((PASS++))
  elif [ "$result" = "WARN" ]; then
    printf "${YELLOW}⚠${NC} %s\n" "$desc"
    ((WARN++))
  else
    printf "${RED}✗${NC} %s\n" "$desc"
    ((FAIL++))
  fi
}

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  CivitasOne Suite — Installation Validation             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "── 1. Gateway Health ──────────────────────────────────────"

if curl -sf "${GATEWAY_URL}/health" > /dev/null 2>&1; then
  check "Gateway healthy (${GATEWAY_URL}/health)" "PASS"
else
  check "Gateway healthy (${GATEWAY_URL}/health)" "FAIL"
fi

echo ""
echo "── 2. Web Application ─────────────────────────────────────"

if curl -sf "${WEB_URL}" > /dev/null 2>&1; then
  check "Web app reachable (${WEB_URL})" "PASS"
else
  check "Web app reachable (${WEB_URL})" "FAIL"
fi

echo ""
echo "── 3. Database Connectivity ───────────────────────────────"

if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" > /dev/null 2>&1; then
  check "PostgreSQL reachable (${PGHOST}:${PGPORT})" "PASS"
else
  check "PostgreSQL reachable (${PGHOST}:${PGPORT})" "FAIL"
fi

echo ""
echo "── 4. Redis Cache ─────────────────────────────────────────"

if redis-cli -u "$REDIS_URL" ping 2>/dev/null | grep -q PONG; then
  check "Redis PING/PONG (${REDIS_URL})" "PASS"
else
  check "Redis PING/PONG (${REDIS_URL})" "WARN"
fi

echo ""
echo "── 5. Queue (SQS) ─────────────────────────────────────────"

if [ "${QUEUE_DRIVER:-}" = "sqs" ]; then
  if aws sqs list-queues --endpoint-url "${AWS_ENDPOINT_URL:-http://localhost:4566}" --region "${AWS_DEFAULT_REGION:-ap-south-1}" > /dev/null 2>&1; then
    check "SQS queue listing (${AWS_ENDPOINT_URL:-real AWS})" "PASS"
  else
    check "SQS queue listing" "FAIL"
  fi
else
  check "Queue driver: ${QUEUE_DRIVER:-memory} (non-SQS — skip validation)" "WARN"
fi

echo ""
echo "── 6. Service Processes ───────────────────────────────────"

if command -v pm2 > /dev/null 2>&1; then
  ONLINE=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; print(sum(1 for p in json.load(sys.stdin) if p['pm2_env']['status']=='online'))" 2>/dev/null || echo "0")
  if [ "$ONLINE" -ge 30 ]; then
    check "PM2 services online: ${ONLINE} (≥30 expected)" "PASS"
  elif [ "$ONLINE" -ge 10 ]; then
    check "PM2 services online: ${ONLINE} (some offline)" "WARN"
  else
    check "PM2 services online: ${ONLINE} (too few)" "FAIL"
  fi
else
  check "PM2 not installed (skip process check)" "WARN"
fi

echo ""
echo "── 7. Observability ───────────────────────────────────────"

if curl -sf "http://localhost:9090/-/healthy" > /dev/null 2>&1; then
  check "Prometheus healthy" "PASS"
else
  check "Prometheus healthy" "WARN"
fi

if curl -sf "http://localhost:3001/api/health" > /dev/null 2>&1; then
  check "Grafana healthy" "PASS"
else
  check "Grafana healthy" "WARN"
fi

echo ""
echo "── 8. Audit Trail Write Test ──────────────────────────────"

AUDIT_RESP=$(curl -sf "${GATEWAY_URL}/v1/audit/events?limit=1" -H "Authorization: Bearer test" 2>/dev/null || echo "")
if [ -n "$AUDIT_RESP" ]; then
  check "Audit events endpoint responsive" "PASS"
else
  check "Audit events endpoint (may require auth)" "WARN"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Results: ${GREEN}${PASS} passed${NC} | ${YELLOW}${WARN} warnings${NC} | ${RED}${FAIL} failed${NC}"
echo "══════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "${RED}VALIDATION FAILED — ${FAIL} check(s) did not pass.${NC}"
  echo "Fix the failures above before proceeding to production."
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  echo ""
  echo "${YELLOW}VALIDATION PASSED WITH WARNINGS — review before go-live.${NC}"
  exit 0
fi

echo ""
echo "${GREEN}ALL CHECKS PASSED — system is ready for operation.${NC}"
exit 0
