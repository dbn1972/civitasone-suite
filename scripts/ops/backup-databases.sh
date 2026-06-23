#!/usr/bin/env bash
# P1-005: Backup all CivitasOne databases
# Usage: ./backup-databases.sh [BACKUP_DIR]
# Requires: pg_dump, PGHOST/PGPORT env vars (or defaults to localhost:5435)

set -euo pipefail

BACKUP_DIR="${1:-/var/backups/civitasone}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"

# List of databases to back up
DATABASES=(
  "civitas_hrms"
  "civitas_payroll"
  "civitas_finance"
  "civitas_procurement"
  "civitas_admin"
  "civitas_identity"
  "civitas_notification"
  "civitas_workflow"
  "civitas_audit"
)

mkdir -p "${BACKUP_DIR}"

echo "[backup] Starting database backups at ${TIMESTAMP}"
echo "[backup] Host: ${PGHOST}:${PGPORT}"
echo "[backup] Output directory: ${BACKUP_DIR}"

FAILED=0

for DB in "${DATABASES[@]}"; do
  OUTFILE="${BACKUP_DIR}/${DB}_${TIMESTAMP}.sql.gz"
  echo "[backup] Dumping ${DB} → ${OUTFILE}"
  if pg_dump -h "${PGHOST}" -p "${PGPORT}" -d "${DB}" --no-owner --no-acl 2>/dev/null | gzip > "${OUTFILE}"; then
    echo "[backup] ✓ ${DB} complete ($(du -h "${OUTFILE}" | cut -f1))"
  else
    echo "[backup] ✗ ${DB} FAILED (database may not exist)"
    rm -f "${OUTFILE}"
    FAILED=$((FAILED + 1))
  fi
done

# Cleanup old backups (retain 7 days)
find "${BACKUP_DIR}" -name "civitas_*.sql.gz" -mtime +7 -delete 2>/dev/null || true

echo "[backup] Done. ${FAILED} failures out of ${#DATABASES[@]} databases."
exit ${FAILED}
