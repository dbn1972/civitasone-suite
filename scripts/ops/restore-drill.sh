#!/usr/bin/env bash
# Restore drill — verify backup can be restored to a scratch database (quarterly DR gate)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/civitasone}"
DRILL_DB="${DRILL_DB:-civitas_finance_drill}"
PGUSER="${PGUSER:-civitas_admin}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"
CONTAINER="${POSTGRES_CONTAINER:-civitasone-postgres}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="/tmp/civitasone-restore-drill-${TIMESTAMP}.log"

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$REPORT"; }

log "=== CivitasOne Restore Drill ==="
log "Backup dir: $BACKUP_DIR"

LATEST=$(ls -t "$BACKUP_DIR"/civitas_finance_*.sql.gz 2>/dev/null | head -1 || true)
if [[ -z "$LATEST" ]]; then
  log "FAIL: No finance backup found in $BACKUP_DIR"
  exit 1
fi
log "Latest backup: $LATEST"

run_psql() {
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    docker exec -i "$CONTAINER" psql -U "$PGUSER" "$@"
  else
    psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" "$@"
  fi
}

log "Creating drill database: $DRILL_DB"
run_psql -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" 2>>"$REPORT" || true
run_psql -d postgres -c "CREATE DATABASE ${DRILL_DB};"

log "Restoring backup..."
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  gunzip -c "$LATEST" | docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$DRILL_DB" >>"$REPORT" 2>&1
else
  gunzip -c "$LATEST" | psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$DRILL_DB" >>"$REPORT" 2>&1
fi

TABLE_COUNT=$(run_psql -d "$DRILL_DB" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');" | tr -d ' ')
BILL_COUNT=$(run_psql -d "$DRILL_DB" -t -c "SELECT count(*) FROM payments.finance_bills;" 2>/dev/null | tr -d ' ' || echo "0")

log "Tables restored: $TABLE_COUNT"
log "Sample row count (finance_bills): $BILL_COUNT"

if [[ "${TABLE_COUNT:-0}" -gt 10 ]]; then
  log "PASS: Restore drill succeeded"
  run_psql -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" >>"$REPORT" 2>&1 || true
  log "Drill DB dropped. Report: $REPORT"
  exit 0
else
  log "FAIL: Insufficient tables after restore"
  exit 1
fi
