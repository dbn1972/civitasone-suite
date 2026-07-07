#!/usr/bin/env bash
# apply-outbox-partitions.sh
# Purpose: Apply the outbox partitioning migration to all 30 DB-backed services.
#
# Usage:
#   ./scripts/ops/apply-outbox-partitions.sh
#   DATABASE_HOST=prod-db.internal ./scripts/ops/apply-outbox-partitions.sh
#
# Environment variables:
#   DATABASE_HOST  — PostgreSQL host (default: localhost)
#   DATABASE_PORT  — PostgreSQL port (default: 5435)
#   DATABASE_USER  — PostgreSQL superuser (default: postgres)
#   PGPASSWORD     — PostgreSQL password (set externally)

set -euo pipefail

DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5435}"
DB_USER="${DATABASE_USER:-postgres}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARTITION_SQL="${SCRIPT_DIR}/partition-outbox.sql"

if [ ! -f "$PARTITION_SQL" ]; then
  echo "ERROR: partition-outbox.sql not found at $PARTITION_SQL"
  exit 1
fi

# All 30 DB-backed services and their database names
declare -a SERVICES=(
  "civitas_identity"
  "civitas_tenant"
  "civitas_policy"
  "civitas_audit"
  "civitas_notification"
  "civitas_finance"
  "civitas_procurement"
  "civitas_contract"
  "civitas_hrms"
  "civitas_payroll"
  "civitas_estab"
  "civitas_asset"
  "civitas_stock"
  "civitas_inventory"
  "civitas_project"
  "civitas_grant"
  "civitas_citizen"
  "civitas_legal"
  "civitas_crm"
  "civitas_helpdesk"
  "civitas_telephony"
  "civitas_knowledge"
  "civitas_location"
  "civitas_report"
  "civitas_analytics"
  "civitas_workflow"
  "civitas_admin"
  "civitas_billing"
  "civitas_install"
  "civitas_plugin"
)

echo "=== Applying outbox partitioning to ${#SERVICES[@]} databases ==="
echo "Host: $DB_HOST:$DB_PORT  User: $DB_USER"
echo ""

FAILED=()
SUCCEEDED=()

for db in "${SERVICES[@]}"; do
  echo -n "  [$db] ... "
  if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" -f "$PARTITION_SQL" -v ON_ERROR_STOP=1 > /dev/null 2>&1; then
    echo "✓"
    SUCCEEDED+=("$db")
  else
    echo "✗ FAILED"
    FAILED+=("$db")
  fi
done

echo ""
echo "=== Results ==="
echo "  Succeeded: ${#SUCCEEDED[@]}/${#SERVICES[@]}"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "  Failed:    ${#FAILED[@]}"
  for db in "${FAILED[@]}"; do
    echo "    - $db"
  done
  echo ""
  echo "Re-run failed databases individually:"
  echo "  psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d <db_name> -f $PARTITION_SQL"
  exit 1
fi
echo ""
echo "All databases partitioned successfully."
