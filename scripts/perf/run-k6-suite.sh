#!/usr/bin/env bash
# PERF-010: runs the full tier-0/1 k6 sanity suite against a locally running
# instance of the fleet (see start-stack.sh). This is what a CI job or a
# developer would invoke; it is NOT wired to any nightly schedule -- see the
# PERF-010 PR description for exactly what is and isn't automated today.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="${ROOT}/.perf-k6-results"
mkdir -p "$RESULTS_DIR"

export JWT_SECRET="${JWT_SECRET:-civitasone-dev-secret}"
export PERF_TENANT_ID="${PERF_TENANT_ID:-00000000-0000-4000-8000-000000000001}"

echo "== Minting perf-test JWT =="
PERF_JWT="$(node "${ROOT}/scripts/perf/mint-perf-token.cjs")"
export PERF_JWT

# Deliberately NOT setting a blanket PERF_VUS/PERF_DURATION default here --
# each k6 script picks its own safe default (see comments in each script),
# calibrated against the real per-endpoint rate limits discovered while
# building this suite (gateway: 1000/min/IP: identity: none found; finance:
# 200/min/tenant; hrms: 300/min/tenant). Override per-run by exporting
# PERF_VUS/PERF_DURATION/PERF_RATE before invoking this script if you
# understand those ceilings and want a different load shape.

run_one() {
  local name="$1" script="$2"
  echo ""
  echo "== k6: ${name} =="
  local out="${RESULTS_DIR}/${name}.json"
  local summary="${RESULTS_DIR}/${name}.txt"
  if k6 run --summary-export="$out" "${ROOT}/scripts/perf/k6/${script}" | tee "$summary"; then
    echo "PASS: ${name}"
  else
    echo "FAIL: ${name}"
    OVERALL_RC=1
  fi
}

OVERALL_RC=0
run_one "gateway-basic" "gateway-basic.js"
sleep 5
run_one "identity-token-validate" "identity-token-validate.js"
sleep 5
run_one "queue-publish" "queue-publish.js"
sleep 5
run_one "finance-hrms-reads" "finance-hrms-reads.js"

echo ""
echo "== Results written to ${RESULTS_DIR} =="
exit "$OVERALL_RC"
