#!/usr/bin/env bash
# quality-gates.sh — Run the world-class quality program gates
# Usage: bash scripts/ci/quality-gates.sh [lane]
# Lanes: L1, L2, L3, all (default)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LANE="${1:-all}"
DATE=$(date +%Y%m%d)
EVIDENCE_DIR="$ROOT/evidence/$DATE"
mkdir -p "$EVIDENCE_DIR"

echo "════════════════════════════════════════════════════"
echo "  CivitasOne Quality Program — Gate Runner"
echo "  Lane: $LANE  Date: $DATE"
echo "════════════════════════════════════════════════════"

run_lane() {
  local lane="$1"
  local desc="$2"
  echo ""
  echo "── $desc ──────────────────────────────────────"
  cd "$ROOT/tests/quality-program"
  npx vitest run "$lane/" --config vitest.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="$EVIDENCE_DIR/${lane}-junit.xml" 2>&1
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    echo "✅ $desc: PASSED"
  else
    echo "❌ $desc: FAILED (exit $exit_code)"
  fi
  return $exit_code
}

FAILURES=0

case "$LANE" in
  L1|l1)
    run_lane "L1-tenant-isolation" "L1 Tenant Isolation (P0)" || FAILURES=$((FAILURES + 1))
    ;;
  L2|l2)
    run_lane "L2-authz-bola" "L2 Authorization / BOLA (P0)" || FAILURES=$((FAILURES + 1))
    ;;
  L3|l3)
    run_lane "L3-data-integrity" "L3 Data & Schema Integrity (P0)" || FAILURES=$((FAILURES + 1))
    ;;
  L4|l4)
    run_lane "L4-api-contract" "L4 API Contract & Input (P1)" || FAILURES=$((FAILURES + 1))
    ;;
  L10|l10)
    run_lane "L10-domain-correctness" "L10 Domain Correctness (P0)" || FAILURES=$((FAILURES + 1))
    ;;
  L6|l6)
    run_lane "L6-security" "L6 Security (P1)" || FAILURES=$((FAILURES + 1))
    ;;
  L7|l7)
    run_lane "L7-reliability" "L7 Reliability (P2)" || FAILURES=$((FAILURES + 1))
    ;;
  L8|l8)
    run_lane "L8-ai-features" "L8 AI Features (P2)" || FAILURES=$((FAILURES + 1))
    ;;
  L11|l11)
    run_lane "L11-mutation-canary" "L11 Mutation & Canary (Meta)" || FAILURES=$((FAILURES + 1))
    ;;
  slo)
    # Handled by the SLO block below; no vitest lane to run.
    ;;
  all)
    run_lane "L1-tenant-isolation" "L1 Tenant Isolation (P0)" || FAILURES=$((FAILURES + 1))
    run_lane "L2-authz-bola" "L2 Authorization / BOLA (P0)" || FAILURES=$((FAILURES + 1))
    run_lane "L3-data-integrity" "L3 Data & Schema Integrity (P0)" || FAILURES=$((FAILURES + 1))
    run_lane "L4-api-contract" "L4 API Contract & Input (P1)" || FAILURES=$((FAILURES + 1))
    run_lane "L6-security" "L6 Security (P1)" || FAILURES=$((FAILURES + 1))
    run_lane "L7-reliability" "L7 Reliability (P2)" || FAILURES=$((FAILURES + 1))
    run_lane "L8-ai-features" "L8 AI Features (P2)" || FAILURES=$((FAILURES + 1))
    run_lane "L10-domain-correctness" "L10 Domain Correctness (P0)" || FAILURES=$((FAILURES + 1))
    run_lane "L11-mutation-canary" "L11 Mutation & Canary (Meta)" || FAILURES=$((FAILURES + 1))
    ;;
  *)
    echo "Unknown lane: $LANE"
    echo "Usage: $0 [L1|L2|L3|L4|L6|L7|L8|L10|L11|slo|all]"
    exit 1
    ;;
esac

# ── SLO measurement (error-budget input for the release gate) ───────────────
# Skipped when k6 is absent: the release gate then reports SLO as UNMEASURED,
# which is visible rather than silently treated as healthy.
if [ "$LANE" = "all" ] || [ "$LANE" = "slo" ]; then
  echo ""
  echo "── SLO Measurement (k6) ───────────────────────────────"
  if command -v k6 >/dev/null 2>&1; then
    bash "$ROOT/scripts/ci/run-slo-measurement.sh" "${SLO_ACTORS:-40}" \
      || echo "SLO measurement did not pass — release gate will report it."
  else
    echo "k6 not installed — SLO will be reported as UNMEASURED."
  fi
fi

# ── Release gate: audit the evidence pack just produced ─────────────────────
if [ "$LANE" = "all" ]; then
  echo ""
  echo "── Release Gate (evidence audit) ──────────────────────"
  node "$ROOT/scripts/ci/release-gate.mjs" --evidence "$EVIDENCE_DIR" || FAILURES=$((FAILURES + 1))
fi

echo ""
echo "════════════════════════════════════════════════════"
if [ $FAILURES -eq 0 ]; then
  echo "  ✅ ALL GATES PASSED"
else
  echo "  ❌ $FAILURES GATE(S) FAILED"
fi
echo "  Evidence: $EVIDENCE_DIR/"
echo "════════════════════════════════════════════════════"
exit $FAILURES
