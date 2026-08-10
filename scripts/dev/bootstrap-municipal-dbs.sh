#!/usr/bin/env bash
# Bootstrap Postgres databases + roles for all 17 municipal Sec5 services.
# Idempotent — safe to re-run on dev or CI clusters.
#
# Usage (local dev, Postgres on :5435):
#   bash scripts/dev/bootstrap-municipal-dbs.sh
#
# Env overrides (same as scripts/ci/bootstrap-postgres.sh):
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"
PGUSER="${PGUSER:-civitas}"
export PGPASSWORD="${PGPASSWORD:-civitas_test}"
PGDATABASE="${PGDATABASE:-postgres}"

echo "→ Municipal DB bootstrap (${PGHOST}:${PGPORT})"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -f "$ROOT/infra/db/bootstrap/bootstrap_municipal_services.sql"
echo "✓ Municipal databases + roles ready (17 services)"
