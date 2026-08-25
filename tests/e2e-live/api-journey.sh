#!/usr/bin/env bash
###############################################################################
# CivitasOne ERP — API E2E Journey Test
# Tests every service through the API gateway (port 8080)
###############################################################################
set -euo pipefail

GW="http://localhost:8080"
PASS=0
FAIL=0
RESULTS=()

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ─── Generate JWT Token ──────────────────────────────────────────────────────
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  CivitasOne ERP — API E2E Journey Test${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}▶ Generating JWT token...${NC}"

TOKEN=$(node -e "
const { createHmac } = require('crypto');
const SECRET = 'civitasone-dev-secret';
const TENANT = '00000000-0000-0000-0000-000000000001';
const now = Math.floor(Date.now() / 1000);
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const header = b64url({ alg: 'HS256', typ: 'JWT' });
const payload = b64url({ sub: '00000000-0000-0000-0000-000000000099', iss: 'civitasone-dev', tid: TENANT, tenantId: TENANT, sid: 'dev-session', email: 'superadmin@civitasone.dev', name: 'Super Admin', roles: ['super_admin','admin','tenant_admin','finance_admin','hr_admin','procurement_admin','asset_admin','project_admin','audit_admin','legal_admin','grant_admin','stock_admin','crm_admin','helpdesk_admin','estab_admin'], iat: now, exp: now + 60*60*12 });
const sig = createHmac('sha256', SECRET).update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
")

echo -e "${GREEN}✓ Token generated (${#TOKEN} chars)${NC}"
echo ""

# ─── Helper Functions ─────────────────────────────────────────────────────────
test_auth_get() {
  local service="$1"
  local endpoint="$2"
  local expected="${3:-200}"
  local label="${service} GET ${endpoint}"

  # Test with token (expect 200 or specified code)
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "${GW}${endpoint}" 2>/dev/null || echo "000")

  if [[ "$status" == "$expected" ]]; then
    echo -e "  ${GREEN}✓ PASS${NC} [${status}] ${label}"
    PASS=$((PASS + 1))
    RESULTS+=("PASS|${label}|${status}")
  else
    echo -e "  ${RED}✗ FAIL${NC} [${status}] ${label} (expected ${expected})"
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL|${label}|${status} (expected ${expected})")
  fi
}

test_no_auth() {
  local service="$1"
  local endpoint="$2"
  local label="${service} NO-AUTH ${endpoint}"

  # Test without token (expect 401)
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Content-Type: application/json" \
    "${GW}${endpoint}" 2>/dev/null || echo "000")

  if [[ "$status" == "401" ]]; then
    echo -e "  ${GREEN}✓ PASS${NC} [${status}] ${label} → 401 Unauthorized"
    PASS=$((PASS + 1))
    RESULTS+=("PASS|${label}|401")
  else
    echo -e "  ${RED}✗ FAIL${NC} [${status}] ${label} (expected 401)"
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL|${label}|${status} (expected 401)")
  fi
}

test_post() {
  local service="$1"
  local endpoint="$2"
  local body="$3"
  local expected="${4:-202}"
  local label="${service} POST ${endpoint}"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "${GW}${endpoint}" 2>/dev/null || echo "000")

  if [[ "$status" == "$expected" ]]; then
    echo -e "  ${GREEN}✓ PASS${NC} [${status}] ${label}"
    PASS=$((PASS + 1))
    RESULTS+=("PASS|${label}|${status}")
  else
    echo -e "  ${RED}✗ FAIL${NC} [${status}] ${label} (expected ${expected})"
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL|${label}|${status} (expected ${expected})")
  fi
}

section() {
  echo ""
  echo -e "${CYAN}── $1 ──${NC}"
}

# ─── Gateway Health Check ─────────────────────────────────────────────────────
section "Gateway Health"
GW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${GW}/health" 2>/dev/null || echo "000")
if [[ "$GW_STATUS" == "200" ]]; then
  echo -e "  ${GREEN}✓ PASS${NC} [${GW_STATUS}] Gateway /health"
  PASS=$((PASS + 1))
  RESULTS+=("PASS|Gateway /health|${GW_STATUS}")
else
  echo -e "  ${RED}✗ FAIL${NC} [${GW_STATUS}] Gateway /health (expected 200)"
  FAIL=$((FAIL + 1))
  RESULTS+=("FAIL|Gateway /health|${GW_STATUS} (expected 200)")
fi

# ─── Finance Service ──────────────────────────────────────────────────────────
section "Finance Service"
test_auth_get "finance" "/api/v1/finance/budgets"
test_auth_get "finance" "/api/v1/finance/accounts"
test_auth_get "finance" "/api/v1/finance/payments"
test_auth_get "finance" "/api/v1/finance/journals"
test_auth_get "finance" "/api/v1/finance/sanctions"
test_auth_get "finance" "/api/v1/finance/dashboard"
test_no_auth  "finance" "/api/v1/finance/budgets"

# ─── Finance Write (CQRS) ────────────────────────────────────────────────────
section "Finance Service — Write (CQRS)"
# BUG FIX: beMinor must be a base-10 integer STRING -- createBudgetBody is now
# bigint-safe (matches createBillBody.grossMinor's convention) and rejects a
# raw JSON number outright.
BUDGET_BODY='{"headId":"dddddddd-0000-0000-0000-000000000001","fy":"2025-26","beMinor":"5000000"}'
test_post "finance" "/api/v1/finance/budgets" "${BUDGET_BODY}" "202"

# ─── HRMS Service ─────────────────────────────────────────────────────────────
section "HRMS Service"
test_auth_get "hrms" "/api/v1/hrms/employees"
test_auth_get "hrms" "/api/v1/hrms/leave-applications"
test_auth_get "hrms" "/api/v1/hrms/attendance"
test_auth_get "hrms" "/api/v1/hrms/dashboard"
test_no_auth  "hrms" "/api/v1/hrms/employees"

# ─── Procurement Service ──────────────────────────────────────────────────────
section "Procurement Service"
test_auth_get "procurement" "/api/v1/procurement/vendors"
test_auth_get "procurement" "/api/v1/procurement/indents"
test_auth_get "procurement" "/api/v1/procurement/rfqs"
test_auth_get "procurement" "/api/v1/procurement/pos"
test_auth_get "procurement" "/api/v1/procurement/grns"
test_auth_get "procurement" "/api/v1/procurement/dashboard"
test_no_auth  "procurement" "/api/v1/procurement/vendors"

# ─── Establishment Service ────────────────────────────────────────────────────
section "Establishment Service"
test_auth_get "estab" "/api/v1/estab/files"
test_auth_get "estab" "/api/v1/estab/meetings"
test_auth_get "estab" "/api/v1/estab/vehicles"
test_auth_get "estab" "/api/v1/estab/dashboard"
test_auth_get "estab" "/api/v1/estab/compliance"
test_no_auth  "estab" "/api/v1/estab/files"

# ─── Stock Service ────────────────────────────────────────────────────────────
section "Stock Service"
test_auth_get "stock" "/api/v1/stock/items"
test_auth_get "stock" "/api/v1/stock/ledger"
test_auth_get "stock" "/api/v1/stock/dashboard"
test_no_auth  "stock" "/api/v1/stock/items"

# ─── Asset Service ────────────────────────────────────────────────────────────
section "Asset Service"
test_auth_get "asset" "/api/v1/asset/assets"
test_auth_get "asset" "/api/v1/asset/maintenance"
test_auth_get "asset" "/api/v1/asset/dashboard"
test_no_auth  "asset" "/api/v1/asset/assets"

# ─── Project Service ──────────────────────────────────────────────────────────
section "Project Service"
test_auth_get "project" "/api/v1/project/projects"
test_auth_get "project" "/api/v1/project/milestones"
test_auth_get "project" "/api/v1/project/dashboard"
test_no_auth  "project" "/api/v1/project/projects"

# ─── Grant Service ────────────────────────────────────────────────────────────
section "Grant Service"
test_auth_get "grants" "/api/v1/grants/grants"
test_auth_get "grants" "/api/v1/grants/grantees"
test_auth_get "grants" "/api/v1/grants/installments"
test_auth_get "grants" "/api/v1/grants/dashboard"
test_no_auth  "grants" "/api/v1/grants/grants"

# ─── Citizen Service ──────────────────────────────────────────────────────────
section "Citizen Service"
test_auth_get "citizen" "/api/v1/citizen/tickets"
test_auth_get "citizen" "/api/v1/citizen/requests"
test_auth_get "citizen" "/api/v1/citizen/rti"
test_no_auth  "citizen" "/api/v1/citizen/tickets"

# ─── Legal Service ────────────────────────────────────────────────────────────
section "Legal Service"
test_auth_get "legal" "/api/v1/legal/cases"
test_auth_get "legal" "/api/v1/legal/hearings"
test_auth_get "legal" "/api/v1/legal/court-orders"
test_auth_get "legal" "/api/v1/legal/dashboard"
test_no_auth  "legal" "/api/v1/legal/cases"

# ─── CRM Service ──────────────────────────────────────────────────────────────
section "CRM Service"
test_auth_get "crm" "/api/v1/crm/contacts"
test_auth_get "crm" "/api/v1/crm/deals"
test_auth_get "crm" "/api/v1/crm/activities"
test_auth_get "crm" "/api/v1/crm/dashboard"
test_no_auth  "crm" "/api/v1/crm/contacts"

# ─── Helpdesk Service ─────────────────────────────────────────────────────────
section "Helpdesk Service"
test_auth_get "helpdesk" "/api/v1/helpdesk/tickets"
test_no_auth  "helpdesk" "/api/v1/helpdesk/tickets"

# ─── Audit Service ────────────────────────────────────────────────────────────
section "Audit Service"
test_auth_get "audit" "/api/v1/audit/events"
test_auth_get "audit" "/api/v1/audit/observations"
test_auth_get "audit" "/api/v1/audit/risks"
test_auth_get "audit" "/api/v1/audit/dashboard"
test_no_auth  "audit" "/api/v1/audit/events"

# ─── Identity Service ─────────────────────────────────────────────────────────
section "Identity Service"
test_auth_get "identity" "/api/identity/users"
test_auth_get "identity" "/api/identity/sessions"
test_no_auth  "identity" "/api/identity/users"

# ─── Policy Service ───────────────────────────────────────────────────────────
section "Policy Service"
test_auth_get "policy" "/api/policy/roles"
test_no_auth  "policy" "/api/policy/roles"

# ─── Admin Service ────────────────────────────────────────────────────────────
section "Admin Service"
test_auth_get "admin" "/api/v1/admin/health" "200"
test_auth_get "admin" "/api/v1/admin/tenant/modules" "200"
test_no_auth  "admin" "/api/v1/admin/health"

# ─── Billing Service ──────────────────────────────────────────────────────────
section "Billing Service"
test_auth_get "billing" "/api/v1/billing/plans" "200"
test_no_auth  "billing" "/api/v1/billing/subscriptions"

# ─── Contract Service ─────────────────────────────────────────────────────────
section "Contract Service"
test_auth_get "contract" "/api/v1/contract/contracts"
test_auth_get "contract" "/api/v1/contract/rate-contracts?item=test"
test_no_auth  "contract" "/api/v1/contract/contracts"

# ─── Knowledge Service ────────────────────────────────────────────────────────
section "Knowledge Service"
test_auth_get "knowledge" "/api/v1/knowledge/documents"
test_no_auth  "knowledge" "/api/v1/knowledge/documents"

# ─── Workflow Service ──────────────────────────────────────────────────────────
section "Workflow Service"
test_auth_get "workflow" "/api/v1/workflow/instances"
test_no_auth  "workflow" "/api/v1/workflow/instances"

# ─── Analytics Service ─────────────────────────────────────────────────────────
section "Analytics Service"
test_auth_get "analytics" "/api/v1/analytics/dashboards"
test_no_auth  "analytics" "/api/v1/analytics/dashboards"

# ─── Report Service ───────────────────────────────────────────────────────────
section "Report Service"
test_auth_get "reports" "/api/v1/reports/dashboards"
test_auth_get "reports" "/api/v1/reports/report-jobs"
test_no_auth  "reports" "/api/v1/reports/dashboards"

# ─── Location Service ─────────────────────────────────────────────────────────
section "Location Service"
test_auth_get "locations" "/api/v1/locations" "200"
test_no_auth  "locations" "/api/v1/locations"

# ─── Install Service ──────────────────────────────────────────────────────────
section "Install Service"
test_auth_get "install" "/api/v1/install/steps" "200"
test_no_auth  "install" "/api/v1/install/steps"

# ─── Plugin Service ───────────────────────────────────────────────────────────
section "Plugin Service"
test_auth_get "plugins" "/api/v1/plugins/items" "200"
test_no_auth  "plugins" "/api/v1/plugins/items"

# ─── Theme Service ────────────────────────────────────────────────────────────
section "Theme Service"
test_auth_get "themes" "/api/v1/themes/tokens" "200"
test_no_auth  "themes" "/api/v1/themes/tokens"

# ─── Telephony Service ────────────────────────────────────────────────────────
section "Telephony Service"
test_auth_get "telephony" "/api/v1/telephony/calls" "200"
test_no_auth  "telephony" "/api/v1/telephony/calls"

# ─── Inventory Service ────────────────────────────────────────────────────────
section "Inventory Service"
test_auth_get "inventory" "/api/v1/inventory/items" "200"
test_no_auth  "inventory" "/api/v1/inventory/items"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  SUMMARY${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TOTAL=$((PASS + FAIL))
echo -e "  ${BOLD}Total Tests:${NC}  ${TOTAL}"
echo -e "  ${GREEN}Passed:${NC}       ${PASS}"
echo -e "  ${RED}Failed:${NC}       ${FAIL}"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}🎉 ALL TESTS PASSED${NC}"
else
  echo -e "  ${YELLOW}${BOLD}⚠  Some tests failed — see details above${NC}"
fi

echo ""
echo -e "${CYAN}── Detailed Results ──${NC}"
printf "  ${BOLD}%-6s %-50s %s${NC}\n" "STATUS" "TEST" "CODE"
echo -e "  ${CYAN}─────────────────────────────────────────────────────────────────────${NC}"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r stat label code <<< "$r"
  if [[ "$stat" == "PASS" ]]; then
    printf "  ${GREEN}%-6s${NC} %-50s %s\n" "$stat" "$label" "$code"
  else
    printf "  ${RED}%-6s${NC} %-50s %s\n" "$stat" "$label" "$code"
  fi
done

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Exit with non-zero if any test failed
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
