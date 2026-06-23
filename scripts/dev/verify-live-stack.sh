#!/usr/bin/env bash
# verify-live-stack.sh — P0 production gate: migrate, seed, start stack, live verify.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "=== migrate-all ==="
node scripts/dev/migrate-all.mjs

echo "=== seed-all ==="
node scripts/dev/seed-all.mjs

echo "=== start-stack ==="
bash scripts/dev/start-stack.sh

echo "=== verify-screens (live gateway) ==="
node scripts/contract/verify-screens.mjs --gateway http://localhost:8080

echo "=== contract score ==="
node scripts/contract/score.mjs
