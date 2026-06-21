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

echo "✅ Postgres bootstrap complete (${PGHOST}:${PGPORT})"
