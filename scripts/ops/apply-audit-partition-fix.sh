#!/usr/bin/env bash
# apply-audit-partition-fix.sh
# Purpose: apply audit-service migration 0038 as the OWNER of events.events (on the UAT DB that is
#          civitas_admin, not audit_svc), so the daily partition job can create future partitions.
#          audit_svc cannot do this itself: creating a partition needs ownership of the parent table.
#          The migration is idempotent; it is safe to run before or after the normal migrator.
#
# Usage:
#   DATABASE_HOST=... DATABASE_PORT=... DATABASE_USER=<table owner> PGPASSWORD=... \
#     ./scripts/ops/apply-audit-partition-fix.sh
#
# No defaults for host/port: 5435/6432 are the shared UAT database and must be chosen deliberately.
set -euo pipefail

DB_HOST="${DATABASE_HOST:?DATABASE_HOST must be set}"
DB_PORT="${DATABASE_PORT:?DATABASE_PORT must be set}"
DB_USER="${DATABASE_USER:?DATABASE_USER must be set (the owner of events.events)}"
DB_NAME="${DATABASE_NAME:-civitas_audit}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${SCRIPT_DIR}/../../services/audit-service/migrations/0038_future_partitions_owner_safe.sql"
[ -f "$SQL" ] || { echo "ERROR: $SQL not found"; exit 1; }

echo "Applying 0038 to ${DB_NAME} at ${DB_HOST}:${DB_PORT} as ${DB_USER}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$SQL"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At \
  -c "SELECT 'missing future partitions: ' || events.missing_future_partitions()"
