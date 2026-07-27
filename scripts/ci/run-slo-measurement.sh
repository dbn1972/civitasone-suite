#!/usr/bin/env bash
# run-slo-measurement.sh — L7 SLO measurement, emitting release-gate evidence.
#
# Generates N distinct actor tokens so the per-user rate limiter is not what gets
# measured (a single token at 50 req/s is mostly 429s), then runs k6 and writes a
# summary to evidence/<date>/L7-k6-slo.json.
#
# Usage: bash scripts/ci/run-slo-measurement.sh [num_actors]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ACTORS="${1:-40}"
GATEWAY="${GATEWAY_URL:-http://localhost:8080}"
SECRET="${JWT_SECRET:-civitasone-dev-secret}"
TENANT="${TENANT_ID:-00000000-0000-0000-0000-000000000001}"
DATE="$(date +%Y%m%d)"
EVIDENCE_DIR="$ROOT/evidence/$DATE"
mkdir -p "$EVIDENCE_DIR"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 not installed — SLO measurement cannot run."
  echo "This is reported as UNMEASURED (not a pass). Install k6 to enable the gate."
  exit 2
fi

echo "── L7 SLO measurement ─────────────────────────────────"
echo "  gateway : $GATEWAY"
echo "  actors  : $ACTORS (distinct, to avoid measuring the rate limiter)"

TOKENS="$(node -e '
const auth = require("'"$ROOT"'/packages/auth/dist/index.js");
const n = Number(process.argv[1]);
const tenant = process.argv[2];
const secret = process.argv[3];
const out = [];
for (let i = 0; i < n; i++) {
  // Distinct actor uuid per token so the per-user limiter bucket differs.
  const suffix = i.toString(16).padStart(12, "0");
  out.push(auth.signToken(
    { sub: `aaaaaaaa-0000-4000-8000-${suffix}`, tid: tenant, roles: ["super_admin"], sid: `slo-${i}` },
    secret,
  ));
}
process.stdout.write(out.join(","));
' "$ACTORS" "$TENANT" "$SECRET")"

set +e
GATEWAY_URL="$GATEWAY" CIVITAS_TOKENS="$TOKENS" \
  k6 run --quiet \
    --summary-export="$EVIDENCE_DIR/L7-k6-slo.json" \
    "$ROOT/tests/load/k6-slo.js"
K6_EXIT=$?
set -e

echo ""
if [ $K6_EXIT -eq 0 ]; then
  echo "SLO measurement PASSED — evidence: $EVIDENCE_DIR/L7-k6-slo.json"
else
  echo "SLO measurement FAILED (k6 threshold breach) — exit $K6_EXIT"
  echo "Evidence still written: $EVIDENCE_DIR/L7-k6-slo.json"
fi
exit $K6_EXIT
