#!/usr/bin/env bash
# run-screens-test.sh — wrapper that sets ESBUILD_BINARY_PATH before running vitest
# Required because the pnpm store may have a wrong-version esbuild binary.
# CI should call this script rather than vitest directly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESBUILD_BIN="${REPO_ROOT}/node_modules/.pnpm/@esbuild+linux-arm64@0.21.5/node_modules/@esbuild/linux-arm64/bin/esbuild"

if [ -x "${ESBUILD_BIN}" ]; then
  export ESBUILD_BINARY_PATH="${ESBUILD_BIN}"
fi

exec "${REPO_ROOT}/node_modules/.bin/vitest" run \
  tests/contract/screens.contract.test.ts \
  "$@"
