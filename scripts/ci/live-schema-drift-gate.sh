#!/usr/bin/env bash
# live-schema-drift-gate.sh — post-deploy schema-drift gate (UAT bundle 10, F100/F109).
#
# Builds the EXPECTED schema in a disposable postgres:16-alpine container with
# scripts/ci/bootstrap-postgres.sh (exactly what CI builds), then compares every
# service database of the LIVE cluster against it with
#   node scripts/ci/schema-drift-guard.mjs --live-readonly
# Live is only read (catalog SELECTs in a READ ONLY transaction, and pg_dump -s).
# Exit: 0 clean, 1 class-(a) drift, 2 setup/usage error. The container is always
# removed (docker rm -f -v), also on failure.
#
# Usage (run from the repo checkout that was just deployed):
#   bash scripts/ci/live-schema-drift-gate.sh [--live-container civitasone-postgres] \
#        [--services procurement,asset] [--out <dir>] [--keep]
# Env: GATE_PG_PORT (default: a free port picked by Docker), GATE_IMAGE.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIVE_CONTAINER="civitasone-postgres"
SERVICES=""
OUT=""
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --live-container) LIVE_CONTAINER="$2"; shift 2 ;;
    --services) SERVICES="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
OUT="${OUT:-$(mktemp -d -t schema-drift-gate.XXXXXX)}"
mkdir -p "$OUT/live-schema"
IMAGE="${GATE_IMAGE:-postgres:16-alpine}"
NAME="schema-drift-gate-$$"
PW="gate_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

cleanup() { [ "$KEEP" = 1 ] || docker rm -f -v "$NAME" >/dev/null 2>&1; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_USER=civitas -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=civitas_test \
  -p "127.0.0.1:${GATE_PG_PORT:-0}:5432" "$IMAGE" >/dev/null || exit 2
PORT="$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')"
case "$PORT" in ''|5435|6432) echo "refusing expected-cluster port '$PORT'" >&2; exit 2 ;; esac
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U civitas >/dev/null 2>&1 && break; sleep 2
done

echo "[gate] building the expected schema on 127.0.0.1:$PORT (log: $OUT/bootstrap.log)"
if ! PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=civitas PGPASSWORD="$PW" PGDATABASE=civitas_test \
     POSTGRES_ADMIN_PASSWORD="$PW" POSTGRES_SUPERUSER_PASSWORD="$PW" \
     bash "$ROOT/scripts/ci/bootstrap-postgres.sh" > "$OUT/bootstrap.log" 2>&1; then
  echo "[gate] expected-schema bootstrap FAILED (see $OUT/bootstrap.log)" >&2
  exit 2
fi

args=(--live-readonly --expected-url "postgres://civitas:${PW}@127.0.0.1:${PORT}/postgres"
      --live-container "$LIVE_CONTAINER" --dump-dir "$OUT/live-schema")
[ -n "$SERVICES" ] && args+=(--services "$SERVICES")
env -u DATABASE_URL node "$ROOT/scripts/ci/schema-drift-guard.mjs" "${args[@]}" 2>&1 | tee "$OUT/drift.txt"
rc=${PIPESTATUS[0]}
echo "[gate] rc=$rc report=$OUT/drift.txt live pg_dump -s: $OUT/live-schema/"
exit "$rc"
