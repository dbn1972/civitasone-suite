#!/usr/bin/env bash
# apply-audit-partition-fix.sh
# Purpose: apply audit-service migration 0038 as the OWNER of events.events (on the UAT DB that is
#          civitas_admin, not audit_svc), so the daily partition job can create future partitions.
#          audit_svc cannot do this itself: creating a partition needs ownership of the parent table.
#          The migration is idempotent; it is safe to run before or after the normal migrator.
#
# RUN THIS FIRST, AS THE OWNER of events.events (civitas_admin on UAT), before/independently of the normal migrator:
# the migrator runs as audit_svc and can only create the new objects, it cannot make the wrappers owner-run.
# Exits non-zero (and says why) if the result is not right: future partitions still missing, or the helper / wrapper
# functions are not owned by the owner of events.events (then the worker would hit "must be owner" again).
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
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At -v ON_ERROR_STOP=1 -c "$1"; }

MISSING="$(Q "SELECT events.missing_future_partitions()")"
echo "missing future partitions: ${MISSING}"
BAD_OWNERS="$(Q "SELECT string_agg(p.oid::regprocedure::text || ' owned by ' || pg_get_userbyid(p.proowner), '; ')
  FROM pg_proc p
 WHERE p.oid IN ('events.ensure_monthly_partitions(text,text,text,date,integer,boolean)'::regprocedure,
                 'events.create_future_partitions()'::regprocedure, '_outbox.create_future_partitions()'::regprocedure)
   AND p.proowner <> (SELECT relowner FROM pg_class WHERE oid = 'events.events'::regclass)")"
STATUS=0
if [ -n "$BAD_OWNERS" ]; then
  echo "ERROR: function owner differs from the owner of events.events: ${BAD_OWNERS}" >&2
  echo "       Re-run as the owner of events.events (DATABASE_USER)." >&2
  STATUS=1
fi
if [ "$MISSING" != "0" ]; then
  echo "ERROR: ${MISSING} of the next 4 monthly partitions (events/_outbox) are still missing." >&2
  STATUS=1
fi
exit "$STATUS"
