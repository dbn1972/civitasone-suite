#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"
PGUSER="${PGUSER:-civitas}"
export PGPASSWORD="${PGPASSWORD:-civitas_test}"
# Captured before the migration loops below reassign PGPASSWORD per service
# role. Role-creating migrations are re-run as this superuser (see
# needs_superuser()), so its password must survive those reassignments.
SUPERUSER_PW="$PGPASSWORD"

# The two cluster-level bootstrap files below create roles and databases, so
# they need a maintenance database to connect to. Neither passed -d, and psql
# defaults dbname to the username — "civitas" — which no image creates. CI sets
# POSTGRES_DB=civitas_test, dev creates none of them, so the very first
# statement died with `FATAL: database "civitas" does not exist` and the script
# exited 2 before applying a single migration. That took the whole Tests job
# down with it, which is why no service suite has run in CI.
#
# `postgres` is the portable target: initdb creates it in both CI images
# (postgis/postgis:16-3.4 and postgres:16-alpine) and it is present on the dev
# cluster, independent of whatever POSTGRES_DB is set to.
PGDATABASE="${PGDATABASE:-postgres}"

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
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$1"
}

# MUST be first. No bootstrap file created civitas_admin, yet
# bootstrap_inspection.sql, bootstrap_metadata.sql and grant_service_schemas.sql
# all depend on it. Against a fresh Postgres — which is what the CI service
# container is — this script aborted with `role "civitas_admin" does not exist`
# at bootstrap_inspection.sql:55 and exited 3 BEFORE APPLYING ANY MIGRATION, so
# every later step ran against an empty database. Invisible on dev machines
# because the role was created there by hand, outside version control.
# Must match the password used later when applying admin-owned migrations
# (see PGPASSWORD reassignment below). Prefer POSTGRES_ADMIN_PASSWORD, then the
# ambient PGPASSWORD (CI sets civitas_test), then the local-dev default.
ADMIN_PW="${POSTGRES_ADMIN_PASSWORD:-${PGPASSWORD:-civitas_dev_pw}}"
echo "→ $ROOT/infra/db/bootstrap/bootstrap_admin_role.sql"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
     -v admin_pw="$ADMIN_PW" -f "$ROOT/infra/db/bootstrap/bootstrap_admin_role.sql"

run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap.generated.sql"
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_new_services.sql"
# refund-service is in the SERVICE_DBS migration loop below (its own
# migrations create the refund/_outbox/_inbox schemas), but no file ever
# created refund_svc or civitas_refund — every migration failed to
# authenticate, indistinguishable from a wrong password. See
# bootstrap_refund.sql for the full story.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_refund.sql"
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_unregistered_services.sql"
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_contract.sql"
run_bootstrap "$ROOT/scripts/ci/bootstrap-remaining-services.sql"
# Three bootstrap files existed in infra/db/bootstrap/ but were never invoked by
# this script, so their databases did not exist in CI at all and their services
# could not be tested. Confirmed against a fresh cluster: the schema-drift guard
# reported civitas_court, civitas_metadata, civitas_ml, civitas_revenue and
# civitas_works as UNREACHABLE. Note the near-identical name of the file above —
# scripts/ci/bootstrap-remaining-services.sql (hyphens) is a DIFFERENT file from
# infra/db/bootstrap/bootstrap_remaining_services.sql (underscores), which is how
# the latter came to be orphaned.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_remaining_services.sql"
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_missing_services.sql"
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_metadata.sql"
# court, meeting and visitor appeared in NO bootstrap file at all, despite all
# three being declared in ecosystem.config.js and routed in the gateway registry.
# All 14 court-service migrations failed on a fresh cluster because civitas_court
# did not exist.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_court_meeting_visitor.sql"
# inspection-service had NO role and NO database in any bootstrap file, so a
# fresh CI database could not host it. Without this line the file exists but the
# pipeline never calls it. Idempotent; safe to re-run.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_inspection.sql"
# Module schemas that migrations reference but no bootstrap file created. Measured
# against a throwaway container: `schema "X" does not exist` was the largest single
# cause of migration failure (30 of 97). Must run before the migration loop.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_missing_schemas.sql"
# Municipal Sec5 batch 3 (crematorium/drainage/event/fire/market/parking) had
# roles/dbs wired into scripts/dev/migrate-all.mjs + grant-all.mjs for local dev
# (PR #830) but no bootstrap file here at all -- the same "role/database never
# created in CI" gap the blocks above this one already fixed for their own
# batches. Without this, all 6 services' migrations fail in CI with
# "database does not exist" before the migration loop ever reaches them.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_sec5_batch3.sql"
# swm-service (solid waste management) was routed in the gateway registry
# (prefix /api/v1/swm) with 5 real Drizzle table definitions across 4
# modules, but no role/database was ever created for it in any bootstrap
# file -- the same "declared but never provisioned" gap as the batches above.
# Without this, swm-service's migrations fail with "database civitas_swm does
# not exist" before the migration loop below ever reaches them.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_swm.sql"
# bootstrap_municipal_services.sql: advertisement/vendor/animal/trade/parks/
# roadcut had real migrations but no role/database anywhere reachable by CI
# (fire/crematorium/drainage/event/market/parking already got theirs from
# bootstrap_sec5_batch3.sql above; this file covers the other 6). Without
# this, all 6 services' migrations fail with role/database does not exist.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_municipal_services.sql"
# shop-service (Sec5 batch 2: parks/refund/roadcut/shop/trade) had a role/db
# in local dev tooling (scripts/dev/provision-sec5-batch2-roles.sql) but no
# bootstrap file here ever created shop_svc/civitas_shop, and it was never
# added to the SERVICE_DBS map below — its migrations never ran in CI. See
# bootstrap_shop.sql for the full story (same gap bootstrap_refund.sql fixed
# for refund-service in the same batch).
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_shop.sql"
# recommendation-service: has real migrations (services/recommendation-
# service/migrations/, 8 files) and 15 test files / 1172 tests that already
# pass cleanly once a database is manually provisioned, but no bootstrap
# file here ever created recommendation_svc/civitas_recommendation, and it
# was never added to the SERVICE_DBS map below -- even though
# scripts/dev/migrate-all.mjs already lists it. Same class of gap as
# shop-service above.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_recommendation.sql"
# sewerage-service had NO bootstrap entry at all (no role, no database) and
# also had no migrations directory until this pass added one -- see
# services/sewerage-service/migrations/0001_initial.sql and the SERVICE_DBS
# entry below.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_sewerage.sql"
# ai-agent-service has real migrations (services/ai-agent-service/migrations/
# 0001_ai_agent_foundation.sql, 0002_ai_agent_sprint2.sql,
# 0003_ai_agent_chat_handoff.sql) and is already wired into
# scripts/dev/provision-platform-roles.mjs (role ai_agent_svc, db
# civitas_ai_agent) and ecosystem.config.js, but no bootstrap file here ever
# created ai_agent_svc/civitas_ai_agent, and ai-agent-service was never added
# to the SERVICE_DBS map below -- so on a fresh CI Postgres its migrations
# fail to even authenticate and its tests can never run against a real
# database in CI. Same class of gap bootstrap_shop.sql/bootstrap_sewerage.sql
# fixed for their services. See bootstrap_ai_agent.sql for the full story.
run_bootstrap "$ROOT/infra/db/bootstrap/bootstrap_ai_agent.sql"

# Every migration that fails is recorded here and reconciled against a committed
# allow-list at the end of this script. Before that reconciliation existed, a
# failed migration printed a warning and the script still exited 0 — which is how
# 97 broken migrations and 231 declared-but-missing columns accumulated without CI
# ever going red.
MIGRATION_FAILURES=()
# Parallel array of "path|first error message", so the generated allow-list records
# WHY each entry fails. A bare list of filenames is not reviewable — a reader
# cannot tell a missing postgis extension from a genuine SQL bug.
MIGRATION_FAILURE_REASONS=()

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
  # These three own their own databases and schemas (verified on the dev cluster:
  # civitas_meeting/civitas_visitor are owned by their service role, and
  # civitas_metadata by metadata_svc), so their migrations run as the service role
  # like everything else here. They had no entry in any migration loop, so their
  # migrations had never run in CI.
  [meeting-service]="meeting_svc:civitas_meeting"
  [visitor-service]="visitor_svc:civitas_visitor"
  [metadata-service]="metadata_svc:civitas_metadata"
  # gateway-service is mostly a proxy, but its catalogue module has a real
  # migration that documents "DB civitas_gateway, role gateway_svc".
  [gateway-service]="gateway_svc:civitas_gateway"
  [analytics-service]="analytics_svc:civitas_analytics"
  [contract-service]="contract_svc:civitas_contract"
  [crm-service]="crm_svc:civitas_crm"
  [stock-service]="stock_svc:civitas_stock"
  [project-service]="project_svc:civitas_project"
  [asset-service]="asset_svc:civitas_asset"
  [estab-service]="estab_svc:civitas_estab"
  # sewerage-service: same gap as journey/catalogue/loyalty/cdp above -- real
  # migration added in this pass (services/sewerage-service/migrations/), but
  # never registered here, so its role/database never existed in CI.
  [sewerage-service]="sewerage_svc:civitas_sewerage"
  [payroll-service]="payroll_svc:civitas_payroll"
  [hrms-service]="hrms_svc:civitas_hrms"
  [theme-service]="theme_svc:civitas_theme"
  [plugin-service]="plugin_svc:civitas_plugin"
  [install-service]="install_svc:civitas_install"
  # refund-service: migrations directory lands with PR #777
  # (fix/municipal-batch2-db-infra, not yet merged as of this line) -- this
  # entry is a no-op until that PR merges (the loop below skips any service
  # whose migrations dir does not exist yet), then correctly provisions
  # civitas_refund so refund-service's DB-integration tests
  # (services/refund-service/tests/*-integration.test.ts) can actually run
  # in CI instead of silently protecting nobody.
  [refund-service]="refund_svc:civitas_refund"
  # cdp-service, catalogue-service, loyalty-service, journey-service: real
  # migrations + 37 test files between them, but none of the four were ever
  # added here, so their roles/databases never existed in CI (see
  # bootstrap_unregistered_services.sql).
  [cdp-service]="cdp_svc:civitas_cdp"
  [catalogue-service]="catalogue_svc:civitas_catalogue"
  [loyalty-service]="loyalty_svc:civitas_loyalty"
  [journey-service]="journey_svc:civitas_journey"
  # swm-service: role/database created by bootstrap_swm.sql above (see that
  # file for the "declared in the gateway registry but never provisioned"
  # backstory). Migrations live at services/swm-service/migrations/.
  [swm-service]="swm_svc:civitas_swm"
  # shop-service: migrations directory has existed since the service was
  # scaffolded, but (like refund-service before bootstrap_refund.sql, and
  # cdp/catalogue/loyalty/journey above) it was never added here, so its
  # migrations never ran in CI. bootstrap_shop.sql (added above) now creates
  # shop_svc/civitas_shop so this entry is no longer a no-op.
  [shop-service]="shop_svc:civitas_shop"
  # ai-agent-service: same gap as shop/sewerage above -- real migrations
  # exist but were never registered here, so its role/database never
  # existed in CI. bootstrap_ai_agent.sql (added above) now creates
  # ai_agent_svc/civitas_ai_agent.
  [ai-agent-service]="ai_agent_svc:civitas_ai_agent"
  # recommendation-service: role/db created by bootstrap_recommendation.sql
  # above. Migrations live at services/recommendation-service/migrations/.
  # Municipal batch 4 (2026-09-04 CI-wiring pass): 12 municipal services had
  # real migrations but were never added to this map, so their migrations
  # never ran in CI even where a database already existed for them (see
  # bootstrap_municipal_services.sql above for the 6 that needed a new role/db,
  # and bootstrap_sec5_batch3.sql for the other 5 whose role/db already
  # existed but were simply never registered here). building-service has no
  # migrations/ directory yet (a separate change is adding it) — this entry
  # is a safe no-op via the migration loop's own `[ -d "$mig_dir" ] || continue`
  # guard until that migration lands.
  [advertisement-service]="advertisement_svc:civitas_advertisement"
  [vendor-service]="vendor_svc:civitas_vendor"
  [trade-service]="trade_svc:civitas_trade"
  [animal-service]="animal_svc:civitas_animal"
  [fire-service]="fire_svc:civitas_fire"
  [crematorium-service]="crematorium_svc:civitas_crematorium"
  [drainage-service]="drainage_svc:civitas_drainage"
  [event-service]="event_svc:civitas_event"
  [parking-service]="parking_svc:civitas_parking"
  [parks-service]="parks_svc:civitas_parks"
  [roadcut-service]="roadcut_svc:civitas_roadcut"
  [building-service]="building_svc:civitas_building"
  # market-service: role/db already created by bootstrap_sec5_batch3.sql
  # above, but this entry was never added, so the migration loop above never
  # reached it even though civitas_market/market_svc already existed.
  [market-service]="market_svc:civitas_market"
)

# ── Role-creating migrations must run as the bootstrapping SUPERUSER ─────────
#
# The `*_scanner_role.sql` migrations (and admin-service/0018) create or alter
# BYPASSRLS roles so cross-tenant maintenance loops — outbox relay, scheduled
# purge — can scan every tenant's rows. Postgres enforces two separate rules
# here, both verified empirically against postgis/postgis:16-3.4:
#
#   CREATE ROLE ... BYPASSRLS as a NOCREATEROLE role
#     -> ERROR: Only roles with the CREATEROLE attribute may create roles.
#   ...and after GRANTing CREATEROLE, the same statement still fails:
#     -> ERROR: Only roles with the BYPASSRLS attribute may create roles with
#               the BYPASSRLS attribute.
#   ALTER ROLE ... NOSUPERUSER (the idempotent re-assert branch)
#     -> ERROR: Only roles with the SUPERUSER attribute may change the
#               SUPERUSER attribute.
#
# So civitas_admin cannot run these no matter what we grant it short of
# BYPASSRLS + SUPERUSER — and bootstrap_admin_role.sql documents that it must
# stay NOBYPASSRLS precisely so the L3 lane's "no role holds BYPASSRLS"
# assertion keeps meaning something. Escalating it to satisfy CI would hollow
# out that guarantee.
#
# Creating a BYPASSRLS role is a legitimate DBA/superuser operation; in
# production these run once as a superuser. In CI the service container's
# POSTGRES_USER is a superuser, so route exactly these files to it and leave
# every other migration on its normal (service or admin) role.
needs_superuser() {
  # Content-based, not filename-based: catches any migration that creates or
  # alters a role regardless of what it is called. Leading `--` comment lines
  # are stripped first — cdp-service/0001_cdp_foundation.sql merely *mentions*
  # `CREATE ROLE cdp_svc` in prose, and misrouting it to the superuser would
  # silently change the owner of that service's entire foundation schema.
  sed 's/--.*$//' "$1" | grep -qiE "(CREATE|ALTER)[[:space:]]+ROLE[[:space:]]+[a-z_]+"
}

# ── Scanner-role password GUCs ────────────────────────────────────────────
#
# The `*_scanner_role.sql` migrations (helpdesk, visitor, crm, finance, ...)
# deliberately ship no password literal — they read it from a
# `civitas.<role>_password` GUC and fall back to a RANDOM one-time password
# when that GUC is absent, so no committed credential exists for these
# BYPASSRLS roles. This script never set that GUC, so every scanner role got
# an unknown random password on every CI run, while each service's own
# vitest.config.ts already hardcodes the expected CI test DSN as
# `<role>_dev_pw` (e.g. helpdesk_scanner_dev_pw — see
# services/helpdesk-service/vitest.config.ts and the matching
# .env.example files). Result: every test that touched a *_scanner role
# failed with `password authentication failed`, which is what showed up as
# widespread, seemingly-unrelated failures across the Tests job.
#
# Fix: for exactly the migrations that create/alter a `*_scanner` role, set
# that role's GUC to the SAME `<role>_dev_pw` convention already hardcoded
# everywhere else in this repo, via PGOPTIONS for that one psql invocation.
# Not a secret — this only ever runs against an ephemeral CI/dev Postgres
# container, matching civitas_test/helpdesk_dev_pw/etc. elsewhere in this
# script.
scanner_role_guc_options() {
  local role
  role="$(sed 's/--.*$//' "$1" | grep -ioE "CREATE ROLE[[:space:]]+[a-z_]*_scanner\b" | awk '{print $3}' | head -1)"
  if [ -n "$role" ]; then
    echo "-c civitas.${role}_password=${role}_dev_pw"
  fi
}

for svc in $(printf '%s\n' "${!SERVICE_DBS[@]}" | sort); do
  mig_dir="$ROOT/services/$svc/migrations"
  [ -d "$mig_dir" ] || continue
  IFS=: read -r role db <<< "${SERVICE_DBS[$svc]}"
  pw="$(echo "$role" | sed 's/_svc/_dev_pw/')"
  export PGPASSWORD="$pw"
  for f in $(find "$mig_dir" -maxdepth 1 -name '*.sql' | sort); do
    # Role-creating migrations need the superuser (see needs_superuser above).
    if needs_superuser "$f"; then
      run_as="$PGUSER"; run_pw="${POSTGRES_SUPERUSER_PASSWORD:-$SUPERUSER_PW}"
      echo "Applying $(basename "$f") → $db ($svc, superuser-run: creates/alters a role)"
    else
      run_as="$role"; run_pw="$pw"
      echo "Applying $(basename "$f") → $db ($svc)"
    fi
    if ! PGOPTIONS="$(scanner_role_guc_options "$f")" PGPASSWORD="$run_pw" \
         psql -h "$PGHOST" -p "$PGPORT" -U "$run_as" -d "$db" -v ON_ERROR_STOP=1 -f "$f" \
         2>&1 | tee /tmp/bootstrap-migration-out.txt | grep -v '^$'; then :; fi
    if grep -q '^psql:.*ERROR:' /tmp/bootstrap-migration-out.txt; then
      echo "⚠ Migration failed for $svc/$(basename "$f") — DB integration tests for this service may fail in CI."
      MIGRATION_FAILURES+=("$svc/$(basename "$f")")
      # First error only: with ON_ERROR_STOP=1 it is the one that aborted the file.
      MIGRATION_FAILURE_REASONS+=("$svc/$(basename "$f")|$(sed -n 's/^psql:.*ERROR:  //p' /tmp/bootstrap-migration-out.txt | head -1 | cut -c1-110)")
    fi
  done
done

# ── Cross-service read-only evidence grants ───────────────────────────────
#
# services/inventory-service/tests/data-quality.test.ts connects as
# civitas_admin to run READ-ONLY reconciliation checks across several
# service-owned databases (asset, inventory, hrms, payroll, procurement,
# contract, finance). civitas_admin is deliberately NOSUPERUSER NOBYPASSRLS
# and only owns the admin-owned services (see the ADMIN_OWNED_DBS block
# below) — it was never granted into these service-owned databases, so every
# query in that suite failed with `permission denied for schema ...`.
#
# grant_admin_readonly.sql grants USAGE + SELECT only (no BYPASSRLS, no
# ownership change) on every schema the service role owns. Must run AFTER
# that service's own migration loop above, as the owning service role, so
# the schemas already exist.
EVIDENCE_SUITE_DBS=(
  "asset-service:civitas_asset:asset_svc"
  "inventory-service:civitas_inventory:inventory_svc"
  "hrms-service:civitas_hrms:hrms_svc"
  "payroll-service:civitas_payroll:payroll_svc"
  "procurement-service:civitas_procurement:procurement_svc"
  "contract-service:civitas_contract:contract_svc"
  "finance-service:civitas_finance:finance_svc"
)
for entry in "${EVIDENCE_SUITE_DBS[@]}"; do
  IFS=: read -r svc db role <<< "$entry"
  pw="$(echo "$role" | sed 's/_svc/_dev_pw/')"
  PGPASSWORD="$pw" psql -h "$PGHOST" -p "$PGPORT" -U "$role" -d "$db" -v ON_ERROR_STOP=1 \
    -f "$ROOT/infra/db/bootstrap/grant_admin_readonly.sql" >/dev/null \
    || echo "⚠ $svc civitas_admin read-only grant failed"
done

# ── Admin-owned databases: admin-run migrations + grant re-assert ────────────
#
# Deliberately NOT in SERVICE_DBS above. That loop applies migrations as the
# SERVICE role, but these databases follow the admin-owned convention: schemas are
# owned by civitas_admin and the service role holds only USAGE + DML, so it cannot
# ALTER its own tables. Running their migrations as <svc>_svc fails on CREATE
# SCHEMA.
#
# Verified against the dev cluster before listing them here:
#   civitas_court, civitas_inspection, civitas_ml, civitas_revenue, civitas_works
#   are all owned by civitas_admin, and their module schemas are admin-owned too.
#
# court, ml, revenue and works had no entry in ANY migration loop, so their
# migrations had never run in CI even after their databases were created. The
# schema-drift guard reported all four as UNREACHABLE against a fresh cluster.
#
# After migrations, grant_service_schemas.sql re-grants USAGE + DML on whatever
# schemas the migrations just created, without transferring ownership.
ADMIN_OWNED_DBS=(
  "court-service:civitas_court:court_svc"
  "inspection-service:civitas_inspection:inspection_svc"
  "ml-service:civitas_ml:ml_svc"
  "revenue-service:civitas_revenue:revenue_svc"
  "works-service:civitas_works:works_svc"
)
# Do NOT fall back to ambient PGPASSWORD here — the SERVICE_DBS loop above
# overwrites it with each service role password. Always reuse ADMIN_PW from
# role creation so admin-owned migrations authenticate correctly.
export PGPASSWORD="$ADMIN_PW"
ADMIN_USER="${POSTGRES_ADMIN_USER:-civitas_admin}"

for entry in "${ADMIN_OWNED_DBS[@]}"; do
  IFS=: read -r svc db role <<< "$entry"
  mig_dir="$ROOT/services/$svc/migrations"
  [ -d "$mig_dir" ] || continue
  svc_failed=0
  for f in $(find "$mig_dir" -maxdepth 1 -name '*.sql' | sort); do
    # Role-creating migrations need the superuser (see needs_superuser above);
    # civitas_admin is deliberately NOBYPASSRLS/NOCREATEROLE and cannot run them.
    if needs_superuser "$f"; then
      run_as="$PGUSER"; run_pw="${POSTGRES_SUPERUSER_PASSWORD:-$SUPERUSER_PW}"
      echo "Applying $(basename "$f") → $db ($svc, superuser-run: creates/alters a role)"
    else
      run_as="$ADMIN_USER"; run_pw="$ADMIN_PW"
      echo "Applying $(basename "$f") → $db ($svc, admin-run)"
    fi
    if ! PGPASSWORD="$run_pw" psql -h "$PGHOST" -p "$PGPORT" -U "$run_as" -d "$db" \
         -v ON_ERROR_STOP=1 -f "$f" > /tmp/bootstrap-migration-out.txt 2>&1; then
      echo "⚠ Migration failed for $svc/$(basename "$f")"
      svc_failed=$((svc_failed + 1))
      MIGRATION_FAILURES+=("$svc/$(basename "$f")")
      MIGRATION_FAILURE_REASONS+=("$svc/$(basename "$f")|$(sed -n 's/^psql:.*ERROR:  //p' /tmp/bootstrap-migration-out.txt | head -1 | cut -c1-110)")
    fi
  done
  # Re-assert USAGE/DML on schemas the migrations created. Ownership stays admin.
  psql -h "$PGHOST" -p "$PGPORT" -U "$ADMIN_USER" -d "$db" -v ON_ERROR_STOP=1 \
    -v svc_role="$role" -f "$ROOT/infra/db/bootstrap/grant_service_schemas.sql" >/dev/null \
    || echo "⚠ $svc grant re-assert failed"
  echo "$svc migrations: ${svc_failed} failure(s)"
done

# inspection additionally re-runs its own bootstrap, which sets role attributes
# the generic grant file does not touch.
psql -h "$PGHOST" -p "$PGPORT" -U "$ADMIN_USER" -d civitas_inspection \
  -v ON_ERROR_STOP=1 -f "$ROOT/infra/db/bootstrap/bootstrap_inspection.sql" >/dev/null \
  || echo "⚠ inspection bootstrap re-assert failed (expected if civitas_admin lacks CREATEROLE)"

# ── Migration failure reconciliation ─────────────────────────────────────────
#
# Until this block existed, a failed migration printed a warning and the script
# still exited 0. That is how 97 broken migrations went unnoticed, and it is the
# mechanism behind the 231 declared-but-missing columns the schema-drift guard
# reports: a migration aborts, its tables are never created, and nothing fails.
#
# Ratcheted rather than strict, so any future migration that fails on a fresh
# cluster gets exactly one chance to be tracked-and-explained before it's a hard
# failure. The allow-list is TRACKED DEBT, not approval:
#   - a failure NOT in the list      -> exit 1 (new breakage)
#   - a list entry that now PASSES   -> exit 1 (stale; remove it so the breakage
#                                       cannot be reintroduced for free)
# As of the fix landed 2026-08-27, the list is empty (0 entries) — every
# migration that used to fail on a fresh cluster has a real fix. Kept as an
# empty, version-controlled file rather than deleting the mechanism: the day a
# migration breaks again, this is where it gets caught and named.
#
# Regenerate only after a real fix, and only against a FRESH cluster — measuring
# on a developer machine understates failures, because schemas and roles created
# there by hand mask exactly the defects this catches:
#   docker run -d --name pgprobe -e POSTGRES_USER=civitas -e POSTGRES_PASSWORD=civitas_test \
#     -e POSTGRES_DB=civitas_test -p 5499:5432 postgres:16-alpine
#   PGHOST=localhost PGPORT=5499 PGUSER=civitas PGPASSWORD=civitas_test \
#     PGDATABASE=civitas_test POSTGRES_ADMIN_PASSWORD=civitas_test \
#     BOOTSTRAP_WRITE_ALLOWLIST=1 bash scripts/ci/bootstrap-postgres.sh
#
# `awk 'NF'` below, not `grep -v '^$'`: with `set -o pipefail` (see top of file),
# a pipeline's exit status is non-zero if ANY stage fails, and `grep -v` follows
# the general grep convention of exiting 1 when it selects zero lines — which is
# exactly what "zero observed failures" or "zero allow-listed entries" produces.
# That non-zero status would trip `set -e` and abort the script before it could
# ever print success, INCLUDING in the now-real case of a fully clean run. Never
# reproduced before today because the allow-list had never been empty. `awk 'NF'`
# does the same "drop blank lines" job but exits 0 regardless of how many lines
# matched, so a genuinely clean result can actually be reported as one.
ALLOWLIST="$ROOT/scripts/ci/migration-failure-allowlist.txt"

printf '%s\n' "${MIGRATION_FAILURES[@]+"${MIGRATION_FAILURES[@]}"}" \
  | awk 'NF' | sort -u > /tmp/bootstrap-failures-observed.txt
observed_count=$(wc -l < /tmp/bootstrap-failures-observed.txt | tr -d ' ')

if [ "${BOOTSTRAP_WRITE_ALLOWLIST:-0}" = "1" ]; then
  {
    echo "# Migrations that fail on a FRESH cluster. TRACKED DEBT, not approval."
    echo "# Each entry means the migration ABORTED and none of its objects were created."
    echo "# The reason after '#' is the first error, which under ON_ERROR_STOP=1 is the"
    echo "# one that aborted the file. Only the path before '#' is compared."
    echo "# Regenerate with BOOTSTRAP_WRITE_ALLOWLIST=1 against a throwaway container."
    echo "# Generated: $(date -u +%Y-%m-%d)  Count: ${observed_count}"
    printf '%s\n' "${MIGRATION_FAILURE_REASONS[@]+"${MIGRATION_FAILURE_REASONS[@]}"}" \
      | awk 'NF' | sort -u \
      | awk -F'|' '{ printf "%-58s # %s\n", $1, $2 }'
  } > "$ALLOWLIST"
  echo "📝 allow-list written: ${observed_count} entries → ${ALLOWLIST}"
  echo "✅ Postgres bootstrap complete (${PGHOST}:${PGPORT})"
  exit 0
fi

if [ ! -f "$ALLOWLIST" ]; then
  echo "❌ allow-list missing: $ALLOWLIST"
  echo "   Refusing to report success — with no baseline, ${observed_count} failure(s) would be silently accepted."
  exit 1
fi

# Strip the trailing "# reason" annotation and surrounding whitespace before
# comparing, so editing a reason never changes the gate's verdict.
sed 's/#.*//' "$ALLOWLIST" | sed 's/[[:space:]]*$//' | awk 'NF' | sort -u \
  > /tmp/bootstrap-failures-allowed.txt
novel=$(comm -23 /tmp/bootstrap-failures-observed.txt /tmp/bootstrap-failures-allowed.txt)
stale=$(comm -13 /tmp/bootstrap-failures-observed.txt /tmp/bootstrap-failures-allowed.txt)

echo "──────────────────────────────────────────────────────────────"
echo "  Migration failures: ${observed_count} observed, $(wc -l < /tmp/bootstrap-failures-allowed.txt | tr -d ' ') allow-listed"

rc=0
if [ -n "$novel" ]; then
  echo "  ❌ NEW migration failure(s) — not in the allow-list:"
  printf '      %s\n' $novel
  echo "     A migration that aborts creates none of its objects. Fix it, or record"
  echo "     it with a reason if the failure is genuinely expected."
  rc=1
fi
if [ -n "$stale" ]; then
  echo "  ❌ allow-listed migration(s) now PASS — remove them from the allow-list:"
  printf '      %s\n' $stale
  echo "     Leaving them listed lets the breakage be reintroduced for free."
  rc=1
fi
[ "$rc" -eq 0 ] && echo "  ✅ RATCHET HOLDING — no new migration failures."
echo "──────────────────────────────────────────────────────────────"
[ "$rc" -eq 0 ] || exit 1

echo "✅ Postgres bootstrap complete (${PGHOST}:${PGPORT})"
