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
  all)
    run_lane "L1-tenant-isolation" "L1 Tenant Isolation (P0)" || FAILURES=$((FAILURES + 1))
    run_lane "L2-authz-bola" "L2 Authorization / BOLA (P0)" || FAILURES=$((FAILURES + 1))
    run_lane "L3-data-integrity" "L3 Data & Schema Integrity (P0)" || FAILURES=$((FAILURES + 1))
    ;;
  *)
    echo "Unknown lane: $LANE"
    echo "Usage: $0 [L1|L2|L3|all]"
    exit 1
    ;;
esac

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
