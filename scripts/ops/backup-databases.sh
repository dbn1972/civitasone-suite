#!/usr/bin/env bash
# P1-005 / G10 (Req 11): Backup all 33 CivitasOne service databases
# Usage: ./backup-databases.sh [BACKUP_DIR]
# Requires: pg_dump, node, PGHOST/PGPORT env vars (or defaults to localhost:5435)
#
# Env vars:
#   BACKUP_RETENTION_DAYS  Days of backups to retain before the cleanup sweep
#                          deletes them (default 7, Req 11.3).
#
# Per-database outcome is classified as one of `success` / `failed` / `skipped`
# (skipped when the target database does not exist in this environment, e.g.
# the stateless gateway/queue services — Req 11.4) and the map is handed to
# scripts/ops/lib/outcome-aggregation.mjs, which is the single source of truth
# for the pass/fail exit code: the run fails iff a Tier-0/Tier-1 database's
# outcome is `failed` (Req 11.2). A skip, or a failure limited to a Tier-2
# database, never fails the job by itself.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKUP_DIR="${1:-/var/backups/civitasone}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

# Full 33-service list, mirrored from the `SERVICES` array in
# scripts/dev/provision-silo-tenant.mjs (31 DB-backed services) plus the two
# stateless services (`gateway`, `queue`) that round out the platform's fleet
# of 33 microservices but own no dedicated database of their own — they are
# expected to always classify as `skipped` (Req 11.4), consistent with
# docs/PRODUCT-AUDIT-2026-07-01.md's note that civitas_gateway/civitas_queue
# don't exist. Mapped to `civitas_<svc>` names.
DATABASES=(
  "civitas_admin"
  "civitas_analytics"
  "civitas_asset"
  "civitas_audit"
  "civitas_billing"
  "civitas_citizen"
  "civitas_contract"
  "civitas_crm"
  "civitas_estab"
  "civitas_finance"
  "civitas_gateway"
  "civitas_grant"
  "civitas_helpdesk"
  "civitas_hrms"
  "civitas_identity"
  "civitas_install"
  "civitas_inventory"
  "civitas_knowledge"
  "civitas_legal"
  "civitas_location"
  "civitas_notification"
  "civitas_payroll"
  "civitas_plugin"
  "civitas_policy"
  "civitas_procurement"
  "civitas_project"
  "civitas_queue"
  "civitas_report"
  "civitas_stock"
  "civitas_telephony"
  "civitas_tenant"
  "civitas_theme"
  "civitas_workflow"
)

mkdir -p "${BACKUP_DIR}"

echo "[backup] Starting database backups at ${TIMESTAMP}"
echo "[backup] Host: ${PGHOST}:${PGPORT}"
echo "[backup] Output directory: ${BACKUP_DIR}"
echo "[backup] Retention: ${BACKUP_RETENTION_DAYS} day(s)"

declare -A OUTCOMES

for DB in "${DATABASES[@]}"; do
  SVC="${DB#civitas_}"
  OUTFILE="${BACKUP_DIR}/${DB}_${TIMESTAMP}.sql.gz"

  # Check target-database existence up front (Req 11.4): a database that
  # doesn't exist in this environment (e.g. the stateless gateway/queue
  # services never get their own DB) is a `skipped` outcome, never `failed`.
  # This is a positive existence check via `pg_database`, independent of
  # pg_dump's stderr wording, so classification does not depend on matching
  # a specific error-message string.
  DB_EXISTS=$(psql -h "${PGHOST}" -p "${PGPORT}" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB}'" 2>/dev/null || true)

  if [[ "${DB_EXISTS}" != "1" ]]; then
    echo "[backup] ⊘ ${DB} skipped (database does not exist in this environment)"
    OUTCOMES["${SVC}"]="skipped"
    continue
  fi

  STDERR_FILE=$(mktemp)
  echo "[backup] Dumping ${DB} → ${OUTFILE}"

  if pg_dump -h "${PGHOST}" -p "${PGPORT}" -d "${DB}" --no-owner --no-acl 2>"${STDERR_FILE}" | gzip > "${OUTFILE}"; then
    echo "[backup] ✓ ${DB} complete ($(du -h "${OUTFILE}" | cut -f1))"
    OUTCOMES["${SVC}"]="success"
  else
    echo "[backup] ✗ ${DB} FAILED"
    sed 's/^/[backup]   /' "${STDERR_FILE}" >&2
    OUTCOMES["${SVC}"]="failed"
    rm -f "${OUTFILE}"
  fi

  rm -f "${STDERR_FILE}"
done

# Cleanup old backups (retain BACKUP_RETENTION_DAYS days, default 7)
find "${BACKUP_DIR}" -name "civitas_*.sql.gz" -mtime "+${BACKUP_RETENTION_DAYS}" -delete 2>/dev/null || true

# Build the {service: outcome} JSON map and hand it to the shared aggregation
# module, which is the single source of truth for the overall pass/fail rule
# (Req 11.2/11.4): fails iff a Tier-0/Tier-1 database's outcome is `failed`.
OUTCOMES_JSON="{"
FIRST=1
for SVC in "${!OUTCOMES[@]}"; do
  if [[ ${FIRST} -eq 0 ]]; then
    OUTCOMES_JSON+=","
  fi
  OUTCOMES_JSON+="\"${SVC}\":\"${OUTCOMES[${SVC}]}\""
  FIRST=0
done
OUTCOMES_JSON+="}"

set +e
AGGREGATION_REPORT=$(printf '%s' "${OUTCOMES_JSON}" | node "${SCRIPT_DIR}/lib/outcome-aggregation.mjs")
AGGREGATION_EXIT=$?
set -e

echo "[backup] ── Outcome report ──"
echo "${AGGREGATION_REPORT}"

SUCCESS_COUNT=0
FAILED_COUNT=0
SKIPPED_COUNT=0
for SVC in "${!OUTCOMES[@]}"; do
  case "${OUTCOMES[${SVC}]}" in
    success) SUCCESS_COUNT=$((SUCCESS_COUNT + 1)) ;;
    failed) FAILED_COUNT=$((FAILED_COUNT + 1)) ;;
    skipped) SKIPPED_COUNT=$((SKIPPED_COUNT + 1)) ;;
  esac
done

echo "[backup] Done. ${SUCCESS_COUNT} succeeded, ${FAILED_COUNT} failed, ${SKIPPED_COUNT} skipped out of ${#DATABASES[@]} databases."
exit ${AGGREGATION_EXIT}
