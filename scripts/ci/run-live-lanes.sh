#!/usr/bin/env bash
# run-live-lanes.sh -- run the quality-program lanes that need a LIVE gateway
# (L1 tenant isolation, L2 authz/BOLA, L4 API contract) and stage one JUnit file
# per lane where release-gate.mjs looks for it: <out>/<YYYYMMDD>/<LANE>-<name>.xml.
#
# Why this exists: release-gate.mjs treats a lane with no artifact as UNMEASURED
# and blocks. L1/L2/L4 had no producer anywhere in CI (only L0/L3/L6/L8/L10/L11
# did), so the gate on main could never reach a verdict better than BLOCKED
# whatever the code did.
#
# Evidence is staged in its own directory (default ci-evidence/), NOT in the
# repo's committed evidence/ tree, so the uploaded artifact carries only files
# this run produced.
#
# Runs every lane even if an earlier one fails (each failure is its own FAIL
# evidence), then exits non-zero if any lane failed.
#
# Usage: bash scripts/ci/run-live-lanes.sh [out-dir]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/ci-evidence}"
# The lanes run from tests/quality-program, so a relative out-dir must be pinned
# to the caller's cwd first.
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
STAMP="$(date -u +%Y%m%d)"
DEST="$OUT/$STAMP"
mkdir -p "$DEST"

# lane directory : evidence file name (lane id must appear in the name)
LANES=(
  "L1-tenant-isolation:L1-tenant-isolation.xml"
  "L2-authz-bola:L2-authz-bola.xml"
  "L4-api-contract:L4-api-contract.xml"
)

# vitest.config.ts always writes the same junit path, so remove a stale copy
# first: a lane that crashes before reporting must not inherit the previous
# lane's (or a committed) result.
JUNIT="$ROOT/evidence/quality-program-junit.xml"
FAILED=0
cd "$ROOT/tests/quality-program"
for entry in "${LANES[@]}"; do
  lane="${entry%%:*}"
  file="${entry##*:}"
  echo "-- $lane --"
  rm -f "$JUNIT"
  if ! npx vitest run "$lane/" --config vitest.config.ts; then
    echo "::error::$lane failed"
    FAILED=$((FAILED + 1))
  fi
  if [ -f "$JUNIT" ] && cp "$JUNIT" "$DEST/$file"; then
    :
  else
    echo "::error::$lane produced no JUnit report (or it could not be staged)"
    FAILED=$((FAILED + 1))
  fi
done

echo "evidence staged in $DEST:"
ls -1 "$DEST"
exit $((FAILED > 0 ? 1 : 0))
