#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# docker-native-build.sh — D-ST-07 criterion (2): the ZEN native binding builds
# and loads in the repo Dockerfile base (node:20.20.2-bookworm-slim), AND an
# offline / air-gapped install path works (install from a local vendor dir / tarball
# with no network).
#
# This script:
#   1. Creates a DEDICATED buildx builder (so the host's default is untouched),
#      and removes it on exit.
#   2. Stage A (online baseline): builds an image that `npm ci` the spike against
#      the public registry inside node:20.20.2-bookworm-slim, then loads the
#      native binding and runs a smoke evaluation. Proves the prebuilt
#      linux-<arch>-gnu binary loads on the exact prod base.
#   3. Stage B (air-gapped): vendors @gorules/zen-engine + its platform binary as
#      local tarballs on the host, copies them into the build context, and
#      installs with --offline / no network inside the image, then smoke-tests.
#
# Usage: docker-native-build.sh <out-log-dir>
# Exit 0 iff both stages load the binding and the smoke evaluation returns the
# expected result.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

OUT_DIR="${1:-bench-results}"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # spikes/policy
BUILDER="st-m01-14-policy-$$"
CTX="$(mktemp -d /tmp/st-m01-14-dockerctx.XXXXXX)"
ZEN_VERSION="2.1.4"

cleanup() {
  docker buildx rm "$BUILDER" >/dev/null 2>&1 || true
  rm -rf "$CTX" || true
}
trap cleanup EXIT

echo "== creating dedicated buildx builder: $BUILDER =="
docker buildx create --name "$BUILDER" --driver docker-container --bootstrap >/dev/null

# ── Smoke script run INSIDE the image (ESM): load binding + evaluate ─────────
cat > "$CTX/smoke.mjs" <<'JS'
import { ZenEngine } from "@gorules/zen-engine";
const graph = {
  contentType: "application/vnd.gorules.decision",
  nodes: [
    { id: "in", type: "inputNode", name: "request", position: { x: 0, y: 0 } },
    { id: "dt", type: "decisionTableNode", name: "t", position: { x: 300, y: 0 },
      content: { hitPolicy: "first",
        inputs: [{ id: "i1", name: "Tenure", field: "tenureMonths" }],
        outputs: [{ id: "o1", name: "Eligible", field: "eligible" }],
        rules: [ { _id: "r1", i1: ">= 36", o1: "true" }, { _id: "r2", i1: "", o1: "false" } ] } },
    { id: "out", type: "outputNode", name: "result", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", sourceId: "in", targetId: "dt", type: "edge" },
    { id: "e2", sourceId: "dt", targetId: "out", type: "edge" },
  ],
};
const engine = new ZenEngine();
const decision = engine.createDecision(Buffer.from(JSON.stringify(graph)));
const res = await decision.evaluate({ tenureMonths: 48 }, { trace: true });
engine.dispose();
const ok = res.result && res.result.eligible === true;
console.log("NATIVE_SMOKE", JSON.stringify({ node: process.version, arch: process.arch, result: res.result, ok }));
if (!ok) process.exit(3);
JS

# ── Stage A: online baseline on the exact prod base ──────────────────────────
cat > "$CTX/Dockerfile.online" <<DOCKER
# syntax=docker/dockerfile:1.7
FROM node:20.20.2-bookworm-slim
WORKDIR /spike
COPY package.online.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund @gorules/zen-engine@${ZEN_VERSION}
COPY smoke.mjs ./smoke.mjs
RUN node smoke.mjs
DOCKER
cat > "$CTX/package.online.json" <<JSON
{ "name": "zen-online", "private": true, "type": "module" }
JSON

echo "== Stage A (online) building on node:20.20.2-bookworm-slim =="
docker buildx --builder "$BUILDER" build --load --progress=plain \
  -f "$CTX/Dockerfile.online" -t st-m01-14-zen-online:tmp "$CTX" \
  2>&1 | tee "$OUT_DIR/docker-online.log"

# ── Stage B: air-gapped install from a vendored local tarball store ──────────
echo "== vendoring zen tarballs on host for the offline stage =="
VENDOR="$CTX/vendor"
mkdir -p "$VENDOR"
# Resolve the platform binary package for linux (buildx image is this host arch).
ARCH_PKG="@gorules/zen-engine-linux-$(node -e 'process.stdout.write(process.arch)')-gnu"
( cd "$VENDOR" && npm pack "@gorules/zen-engine@${ZEN_VERSION}" "${ARCH_PKG}@${ZEN_VERSION}" >/dev/null )
echo "vendored:"; ls -1 "$VENDOR"

cat > "$CTX/Dockerfile.offline" <<DOCKER
# syntax=docker/dockerfile:1.7
FROM node:20.20.2-bookworm-slim
WORKDIR /spike
COPY vendor ./vendor
COPY smoke.mjs ./smoke.mjs
# No network: install ONLY from the local vendored tarballs. --offline makes npm
# fail rather than silently reach the registry; we also force an empty registry.
RUN npm init -y >/dev/null \\
 && npm install --no-audit --no-fund --offline --registry=http://0.0.0.0:0 \\
      ./vendor/gorules-zen-engine-${ZEN_VERSION}.tgz \\
      ./vendor/\$(ls vendor | grep -E 'zen-engine-linux-.*-gnu') \\
 && node smoke.mjs
DOCKER

echo "== Stage B (air-gapped) building with --network=none =="
# BuildKit: run the install/smoke with no network at all.
docker buildx --builder "$BUILDER" build --load --progress=plain --network=none \
  -f "$CTX/Dockerfile.offline" -t st-m01-14-zen-offline:tmp "$CTX" \
  2>&1 | tee "$OUT_DIR/docker-offline.log" || {
    echo "OFFLINE_STAGE_RESULT=FAIL (see docker-offline.log)"
    # Clean the throwaway images before exiting non-zero.
    docker image rm st-m01-14-zen-online:tmp st-m01-14-zen-offline:tmp >/dev/null 2>&1 || true
    exit 4
  }

echo "== removing throwaway images =="
docker image rm st-m01-14-zen-online:tmp st-m01-14-zen-offline:tmp >/dev/null 2>&1 || true

echo "ONLINE_STAGE_RESULT=PASS"
echo "OFFLINE_STAGE_RESULT=PASS"
