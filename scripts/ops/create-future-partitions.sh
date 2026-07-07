#!/usr/bin/env bash
# create-future-partitions.sh
# Purpose: Call the auto-partition functions across all partitioned services.
#          Run monthly via cron to ensure partitions exist 3 months ahead.
#
# Usage:
#   ./scripts/ops/create-future-partitions.sh
#
# Cron example (run on 1st of every month at 02:00):
#   0 2 1 * * /path/to/scripts/ops/create-future-partitions.sh
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

echo "=== Creating future partitions ($(date -I)) ==="
echo "Host: $DB_HOST:$DB_PORT  User: $DB_USER"
echo ""

# analytics-service: fact_events partitions
echo -n "  [civitas_analytics] analytics.create_future_partitions() ... "
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d civitas_analytics \
  -c "SELECT analytics.create_future_partitions();" > /dev/null 2>&1; then
  echo "✓"
else
  echo "✗ FAILED"
fi

# analytics-service: outbox partitions
echo -n "  [civitas_analytics] _outbox.create_future_partitions() ... "
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d civitas_analytics \
  -c "SELECT _outbox.create_future_partitions();" > /dev/null 2>&1; then
  echo "✓"
else
  echo "✗ FAILED"
fi

# audit-service: events partitions
echo -n "  [civitas_audit] events.create_future_partitions() ... "
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d civitas_audit \
  -c "SELECT events.create_future_partitions();" > /dev/null 2>&1; then
  echo "✓"
else
  echo "✗ FAILED"
fi

# audit-service: outbox partitions
echo -n "  [civitas_audit] _outbox.create_future_partitions() ... "
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d civitas_audit \
  -c "SELECT _outbox.create_future_partitions();" > /dev/null 2>&1; then
  echo "✓"
else
  echo "✗ FAILED"
fi

# All other services: outbox partitions
declare -a OTHER_DBS=(
  "civitas_identity"
  "civitas_tenant"
  "civitas_policy"
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
  "civitas_workflow"
  "civitas_admin"
  "civitas_billing"
  "civitas_install"
  "civitas_plugin"
)

for db in "${OTHER_DBS[@]}"; do
  echo -n "  [$db] _outbox.create_future_partitions() ... "
  if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" \
    -c "SELECT _outbox.create_future_partitions();" > /dev/null 2>&1; then
    echo "✓"
  else
    echo "✗ SKIPPED (function may not exist yet)"
  fi
done

echo ""
echo "=== Done ==="
