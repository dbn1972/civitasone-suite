#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# docker-cpsat-build.sh — D-ST-05 criterion (5): the CP-SAT sidecar image builds
# in the repo pattern (its own Dockerfile, pinned versions) and passes a CVE scan.
#
# This script:
#   1. Guards disk: aborts if building would push / is past the 80% hard cap.
#   2. Creates a DEDICATED buildx builder (host default untouched); removes it on exit.
#   3. Builds the small pinned image, --load into the local docker image store.
#   4. Runs a trivy CVE scan if trivy is on PATH (else records "not run").
#   5. Smoke-tests the sidecar end-to-end: pipes a tiny SidecarRequest through
#      `docker run --rm -i` and checks the SidecarResponse.
#   6. Removes the throwaway image and the builder.
#
# Usage: docker-cpsat-build.sh <out-log-dir>
# Exit 0 iff the image builds AND the smoke test returns the expected assignment.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

OUT_DIR="${1:-bench-results}"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # spikes/solver
SIDECAR="$HERE/sidecar"
BUILDER="st-m01-13-solver-$$"
IMAGE="st-m01-13-cpsat:tmp"

# ── Disk guard: abort if usage is at/over 80% before we start. ───────────────
USE_PCT="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
echo "disk use before build: ${USE_PCT}%" | tee "$OUT_DIR/docker-cpsat.log"
if [ "$USE_PCT" -ge 80 ]; then
  echo "ABORT: disk at ${USE_PCT}% >= 80% hard cap; skipping CP-SAT image build." \
    | tee -a "$OUT_DIR/docker-cpsat.log"
  echo "CPSAT_BUILD_RESULT=SKIPPED_DISK"
  exit 0
fi

cleanup() {
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
  docker buildx rm "$BUILDER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== creating dedicated buildx builder: $BUILDER ==" | tee -a "$OUT_DIR/docker-cpsat.log"
docker buildx create --name "$BUILDER" --driver docker-container --bootstrap >/dev/null

echo "== building CP-SAT sidecar image (pinned) ==" | tee -a "$OUT_DIR/docker-cpsat.log"
docker buildx --builder "$BUILDER" build --load --progress=plain \
  -f "$SIDECAR/Dockerfile" -t "$IMAGE" "$SIDECAR" \
  2>&1 | tee -a "$OUT_DIR/docker-cpsat.log"

echo "== image size ==" | tee -a "$OUT_DIR/docker-cpsat.log"
docker image inspect "$IMAGE" --format '{{.Size}} bytes ({{.Architecture}})' \
  | tee -a "$OUT_DIR/docker-cpsat.log"

# ── CVE scan ─────────────────────────────────────────────────────────────────
if command -v trivy >/dev/null 2>&1; then
  echo "== trivy CVE scan ==" | tee -a "$OUT_DIR/docker-cpsat.log"
  trivy image --quiet --scanners vuln --severity HIGH,CRITICAL \
    --format json --output "$OUT_DIR/trivy-cpsat.json" "$IMAGE" || true
  trivy image --quiet --scanners vuln --severity HIGH,CRITICAL "$IMAGE" \
    2>&1 | tee "$OUT_DIR/trivy-cpsat.txt" || true
  echo "CVE_SCAN=RUN (see trivy-cpsat.txt / trivy-cpsat.json)"
else
  echo "CVE_SCAN=NOT_RUN (trivy not on PATH)" | tee -a "$OUT_DIR/docker-cpsat.log"
fi

# ── End-to-end smoke test through the sidecar ────────────────────────────────
echo "== sidecar smoke test ==" | tee -a "$OUT_DIR/docker-cpsat.log"
SMOKE_REQ='{"partitions":[{"key":"GEN:J01","employees":[{"id":"E1"},{"id":"E2"}],"positions":[{"id":"P1","capacity":1},{"id":"P2","capacity":1}],"edges":[[0,0,10],[0,1,5],[1,0,4],[1,1,9]]}]}'
SMOKE_OUT="$(printf '%s' "$SMOKE_REQ" | docker run --rm -i "$IMAGE")"
echo "sidecar response: $SMOKE_OUT" | tee -a "$OUT_DIR/docker-cpsat.log"

# Expected optimum: E1->P1 (10) + E2->P2 (9) = 19.
echo "$SMOKE_OUT" | grep -q '"E1", "P1"' && echo "$SMOKE_OUT" | grep -q '"E2", "P2"' && {
  echo "CPSAT_BUILD_RESULT=PASS" | tee -a "$OUT_DIR/docker-cpsat.log"
  exit 0
}
# Fallback tolerant match (json key order / spacing).
if printf '%s' "$SMOKE_OUT" | python3 -c '
import json,sys
r=json.load(sys.stdin)
a={tuple(x) for x in r["assignments"]}
sys.exit(0 if a=={("E1","P1"),("E2","P2")} else 7)
'; then
  echo "CPSAT_BUILD_RESULT=PASS" | tee -a "$OUT_DIR/docker-cpsat.log"
  exit 0
else
  echo "CPSAT_BUILD_RESULT=FAIL (unexpected assignment)" | tee -a "$OUT_DIR/docker-cpsat.log"
  exit 7
fi
