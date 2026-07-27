#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"
PGUSER="${PGUSER:-civitas}"
export PGPASSWORD="${PGPASSWORD:-civitas_test}"

echo "Waiting for Postgres at ${PGHOST}:${PGPORT}..."
for i in $(seq 1 30); do
  if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "Postgres not ready after 60s"
    exit 1
  fi
done

run_bootstrap() {
  echo "→ $1"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -f "$1"
}

run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap.generated.sql"
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_new_services.sql"
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_contract.sql"
run_bootstrap "$ROOT/scripts/ci/bootstrap-remaining-services.sql"
# inspection-service had NO role and NO database in any bootstrap file, so a
# fresh CI database could not host it. Without this line the file exists but the
# pipeline never calls it. Idempotent; safe to re-run.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_inspection.sql"

declare -A SERVICE_DBS=(
  [tenant-service]="tenant_svc:civitas_tenant"
  [identity-service]="identity_svc:civitas_identity"
  [policy-service]="policy_svc:civitas_policy"
  [audit-service]="audit_svc:civitas_audit"
  [finance-service]="finance_svc:civitas_finance"
  [procurement-service]="procurement_svc:civitas_procurement"
  [notification-service]="notification_svc:civitas_notification"
  [billing-service]="billing_svc:civitas_billing"
  [grant-service]="grant_svc:civitas_grant"
  [citizen-service]="citizen_svc:civitas_citizen"
  [legal-service]="legal_svc:civitas_legal"
  [admin-service]="admin_svc:civitas_admin"
  [report-service]="report_svc:civitas_report"
  [inventory-service]="inventory_svc:civitas_inventory"
  [telephony-service]="telephony_svc:civitas_telephony"
  [helpdesk-service]="helpdesk_svc:civitas_helpdesk"
  [location-service]="location_svc:civitas_location"
  [knowledge-service]="knowledge_svc:civitas_knowledge"
  [workflow-service]="workflow_svc:civitas_workflow"
  [analytics-service]="analytics_svc:civitas_analytics"
  [contract-service]="contract_svc:civitas_contract"
  [crm-service]="crm_svc:civitas_crm"
  [stock-service]="stock_svc:civitas_stock"
  [project-service]="project_svc:civitas_project"
  [asset-service]="asset_svc:civitas_asset"
  [estab-service]="estab_svc:civitas_estab"
  [payroll-service]="payroll_svc:civitas_payroll"
  [hrms-service]="hrms_svc:civitas_hrms"
  [theme-service]="theme_svc:civitas_theme"
  [plugin-service]="plugin_svc:civitas_plugin"
  [install-service]="install_svc:civitas_install"
)

for svc in $(printf '%s\n' "${!SERVICE_DBS[@]}" | sort); do
  mig_dir="$ROOT/services/$svc/migrations"
  [ -d "$mig_dir" ] || continue
  IFS=: read -r role db <<< "${SERVICE_DBS[$svc]}"
  pw="$(echo "$role" | sed 's/_svc/_dev_pw/')"
  export PGPASSWORD="$pw"
  for f in $(find "$mig_dir" -maxdepth 1 -name '*.sql' | sort); do
    echo "Applying $(basename "$f") → $db ($svc)"
    if ! psql -h "$PGHOST" -p "$PGPORT" -U "$role" -d "$db" -v ON_ERROR_STOP=1 -f "$f"; then
      echo "⚠ Migration failed for $svc/$(basename "$f") — DB integration tests for this service may fail in CI."
    fi
  done
done

# ── inspection-service: admin-run migrations + grant re-assert ───────────────
# Deliberately NOT in SERVICE_DBS above. That loop applies migrations as the
# SERVICE role, but civitas_inspection follows the civitas_court convention where
# schemas are owned by civitas_admin and the service role holds only USAGE + DML.
# Running its migrations as inspection_svc would fail on CREATE SCHEMA.
#
# Migrations therefore run as the admin role, after which the grant block in
# bootstrap_inspection.sql is re-applied so the service role picks up the objects
# the migrations just created.
INSPECTION_MIG="$ROOT/services/inspection-service/migrations"
if [ -d "$INSPECTION_MIG" ]; then
  export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD:-${PGPASSWORD:-civitas_dev_pw}}"
  ADMIN_USER="${POSTGRES_ADMIN_USER:-civitas_admin}"
  insp_failed=0
  for f in $(find "$INSPECTION_MIG" -maxdepth 1 -name '*.sql' | sort); do
    echo "Applying $(basename "$f") → civitas_inspection (admin-run)"
    if ! psql -h "$PGHOST" -p "$PGPORT" -U "$ADMIN_USER" -d civitas_inspection \
         -v ON_ERROR_STOP=1 -f "$f" >/dev/null; then
      echo "⚠ Migration failed for inspection-service/$(basename "$f")"
      insp_failed=$((insp_failed + 1))
    fi
  done
  # Re-assert USAGE/DML on schemas the migrations created.
  psql -h "$PGHOST" -p "$PGPORT" -U "$ADMIN_USER" -d civitas_inspection \
    -v ON_ERROR_STOP=1 -f "$ROOT/infra/db/bootstrap/bootstrap_inspection.sql" >/dev/null \
    || echo "⚠ inspection grant re-assert failed"
  echo "inspection-service migrations: ${insp_failed} failure(s)"
fi

echo "✅ Postgres bootstrap complete (${PGHOST}:${PGPORT})"
