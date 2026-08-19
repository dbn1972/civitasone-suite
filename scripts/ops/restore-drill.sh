#!/usr/bin/env bash
# Restore drill — verify backups can be restored to a scratch database (quarterly DR gate,
# and — as of task 16.1 — the weekly Drill_Scheduler in .github/workflows/dr-drill.yml).
#
# Runs a Restore_Drill against the latest backup of every Tier-0/Tier-1 service database
# (Req 12.1, 12.2), instead of being hardcoded to finance only. Usage:
#
#   scripts/ops/restore-drill.sh                        # drill every Tier-0/Tier-1 service
#   scripts/ops/restore-drill.sh --all-tier01           # same as above, explicit (used by CI)
#   scripts/ops/restore-drill.sh --service finance      # drill a single named service
#   scripts/ops/restore-drill.sh --report-json out.json # also write a Drill_Report artifact
#
# Tier-0/Tier-1 universe (Req 12.2): gateway, identity, queue, finance, estab, workflow, hrms,
# payroll, audit — the exact 9-service `TIER01_SERVICES` export from
# scripts/ops/lib/outcome-aggregation.mjs, which mirrors docs/runbooks/ and
# docs/operations/SLO-SLI-RUNBOOKS.md §3. This script fetches that list at runtime (rather than
# duplicating it in bash) so the two never drift.
#
# `gateway-service` and `queue-service` own no dedicated Postgres database (gateway is
# stateless; queue wraps SQS/RabbitMQ via @civitasone/queue, not a per-service DB) — the same
# reason backup-databases.sh (task 15.3) always classifies civitas_gateway/civitas_queue as
# `skipped`. Because no such backup file is ever produced, this script's own "no backup found"
# check (below) naturally classifies them `skipped` too, without needing to special-case them
# out of the service loop — a missing backup is a skip, not a failure (Req 12.6).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/civitasone}"
PGUSER="${PGUSER:-civitas_admin}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"
CONTAINER="${POSTGRES_CONTAINER:-civitasone-postgres}"
# Minimum number of non-system tables a restored database must contain to be considered a
# structurally complete restore (Req 12.3 — table-count half of drillPassed()).
MIN_TABLE_COUNT="${MIN_TABLE_COUNT:-5}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="/tmp/civitasone-restore-drill-${TIMESTAMP}.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGG_LIB="${SCRIPT_DIR}/lib/outcome-aggregation.mjs"

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$REPORT"; }

# ── Fetch the Tier-0/Tier-1 service universe from the shared aggregation module ────────────
# (single source of truth — see header comment above).
if ! TIER01_SERVICES_LIST=$(node -e "import('${AGG_LIB}').then(m => console.log(m.TIER01_SERVICES.join(' ')))" 2>>"$REPORT"); then
  echo "restore-drill: failed to load TIER01_SERVICES from ${AGG_LIB}" >&2
  exit 2
fi
read -r -a TIER01_SERVICES <<<"$TIER01_SERVICES_LIST"

# Known-table sample-row check per service (Req 12.3 — sample-row half of drillPassed()).
# Each entry is a stable, long-lived core table from that service's 0001_init.sql migration,
# used only to confirm the restored database is genuinely queryable (existence check via
# `SELECT count(*)`), not to assert a minimum row count — an empty-but-structurally-intact
# restored database (e.g. a freshly provisioned tenant with no data yet) must still be able to
# pass the drill. `gateway` and `queue` have no dedicated database and therefore no backup to
# restore in the first place (see header comment), so they intentionally have no entry here —
# they never reach the sample-row check because the "no backup found" skip short-circuits
# before it.
declare -A SAMPLE_TABLE=(
  [identity]="users.users"
  [finance]="payments.finance_bills"
  [estab]="files.estab_files"
  [workflow]="workflow.instances"
  [hrms]="employee.hrms_departments"
  [payroll]="payroll.payroll_structures"
  [audit]="events.events"
  # Not part of the fixed Tier-0/Tier-1 universe (TIER01_SERVICES above), but
  # drilled explicitly by dr-drill.yml alongside it (task 39, Req 7.5
  # operational gate) — the estab-inv-int-go-live spec requires restore
  # coverage for both the estab schemas (files/quarters/spaces, all three
  # already covered above by the single `estab` entry — one Postgres
  # database, `civitas_estab`, shared across those three PG schemas) AND the
  # inventory-service database, which this project's core Tier-0/Tier-1 list
  # never included.
  [inventory]="inventory.items"
)

# ── CLI parsing ───────────────────────────────────────────────────────────────────────────────
SERVICE_FILTER=""
REPORT_JSON_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)
      SERVICE_FILTER="${2:-}"
      if [[ -z "$SERVICE_FILTER" ]]; then
        echo "restore-drill: --service requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    --all-tier01)
      # Explicit form of the default (no --service given) — accepted for readability in CI
      # workflows (task 16.5's dr-drill.yml invokes this flag explicitly).
      SERVICE_FILTER=""
      shift
      ;;
    --report-json)
      REPORT_JSON_PATH="${2:-}"
      if [[ -z "$REPORT_JSON_PATH" ]]; then
        echo "restore-drill: --report-json requires a file path" >&2
        exit 2
      fi
      shift 2
      ;;
    *)
      echo "restore-drill: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$SERVICE_FILTER" ]]; then
  SERVICES_TO_DRILL=("$SERVICE_FILTER")
else
  SERVICES_TO_DRILL=("${TIER01_SERVICES[@]}")
fi

log "=== CivitasOne Restore Drill ==="
log "Backup dir: $BACKUP_DIR"
log "Services: ${SERVICES_TO_DRILL[*]}"

run_psql() {
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    docker exec -i "$CONTAINER" psql -U "$PGUSER" "$@"
  else
    psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" "$@"
  fi
}

# ── Cleanup: always drop whatever scratch DB is currently in flight, on ANY exit path ───────
# (Req 12.5). Tracks at most one "in-flight" scratch DB at a time; the per-service loop body
# also drops its own scratch DB as soon as it's done with it and clears this variable, so the
# trap is a safety net for the case where a step fails/crashes mid-service (set -e will exit
# the whole script, firing this trap before the loop's own cleanup runs).
CURRENT_DRILL_DB=""
cleanup() {
  if [[ -n "$CURRENT_DRILL_DB" ]]; then
    run_psql -d postgres -c "DROP DATABASE IF EXISTS ${CURRENT_DRILL_DB};" >>"$REPORT" 2>&1 || true
    log "Cleaned up scratch DB: $CURRENT_DRILL_DB"
    CURRENT_DRILL_DB=""
  fi
}
trap cleanup EXIT

# Deterministic pass/fail rule (Req 12.3 / Property 6): BOTH the table-count threshold AND the
# sample-row check must independently succeed for the drill to pass. A corrupted/truncated
# backup fails at least one of the two checks, so it is always classified `failed`, never a
# false `passed`.
drillPassed() {
  local table_count="$1"
  local sample_row_check="$2" # "1" = pass, "0" = fail
  [[ "$table_count" =~ ^[0-9]+$ ]] || return 1
  [[ "$table_count" -gt "$MIN_TABLE_COUNT" && "$sample_row_check" == "1" ]]
}

declare -A OUTCOMES
declare -A TABLE_COUNTS
declare -A SAMPLE_RESULTS
declare -A SAMPLE_TABLES_USED
SERVICE_JSON_FRAGMENTS=()

json_escape() {
  # Minimal JSON string escaper for the handful of characters that can appear in our own
  # log/table/service-name values (paths, dotted table names). Not a general-purpose escaper.
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

for SERVICE in "${SERVICES_TO_DRILL[@]}"; do
  log "--- Drilling service: $SERVICE ---"

  LATEST=$(ls -t "$BACKUP_DIR"/civitas_"${SERVICE}"_*.sql.gz 2>/dev/null | head -1 || true)
  if [[ -z "$LATEST" ]]; then
    log "SKIP: No backup found for $SERVICE in $BACKUP_DIR"
    OUTCOMES[$SERVICE]="skipped"
    SERVICE_JSON_FRAGMENTS+=("\"$(json_escape "$SERVICE")\":{\"outcome\":\"skipped\",\"tableCount\":null,\"sampleRowCheck\":null,\"sampleTable\":null}")
    continue
  fi
  log "Latest backup: $LATEST"

  DRILL_DB="civitas_${SERVICE}_drill"
  CURRENT_DRILL_DB="$DRILL_DB"

  run_psql -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" >>"$REPORT" 2>&1 || true
  if ! run_psql -d postgres -c "CREATE DATABASE ${DRILL_DB};" >>"$REPORT" 2>&1; then
    log "FAIL: Could not create scratch database for $SERVICE"
    OUTCOMES[$SERVICE]="failed"
    SERVICE_JSON_FRAGMENTS+=("\"$(json_escape "$SERVICE")\":{\"outcome\":\"failed\",\"tableCount\":null,\"sampleRowCheck\":null,\"sampleTable\":null}")
    run_psql -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" >>"$REPORT" 2>&1 || true
    CURRENT_DRILL_DB=""
    continue
  fi

  log "Restoring backup for $SERVICE..."
  RESTORE_OK=1
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    gunzip -c "$LATEST" | docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$DRILL_DB" >>"$REPORT" 2>&1 || RESTORE_OK=0
  else
    gunzip -c "$LATEST" | psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$DRILL_DB" >>"$REPORT" 2>&1 || RESTORE_OK=0
  fi

  TABLE_COUNT=$(run_psql -d "$DRILL_DB" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');" 2>>"$REPORT" | tr -d ' ' || echo "0")
  TABLE_COUNT="${TABLE_COUNT:-0}"
  [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]] || TABLE_COUNT=0

  SAMPLE_TABLE_NAME="${SAMPLE_TABLE[$SERVICE]:-}"
  SAMPLE_ROW_CHECK=0
  if [[ -n "$SAMPLE_TABLE_NAME" ]]; then
    if run_psql -d "$DRILL_DB" -t -c "SELECT count(*) FROM ${SAMPLE_TABLE_NAME};" >>"$REPORT" 2>&1; then
      SAMPLE_ROW_CHECK=1
    fi
  else
    # No known sample table registered for this service (e.g. a --service value outside the
    # documented Tier-0/Tier-1 list) — fall back to "at least one restored table is queryable"
    # as a best-effort existence check rather than skipping the second half of drillPassed().
    log "WARN: no sample table registered for $SERVICE; falling back to generic table-existence check"
    if [[ "${TABLE_COUNT:-0}" -gt 0 ]]; then
      SAMPLE_ROW_CHECK=1
    fi
  fi

  log "Tables restored: $TABLE_COUNT (threshold: > $MIN_TABLE_COUNT)"
  log "Sample-row check (${SAMPLE_TABLE_NAME:-<generic>}): $([[ "$SAMPLE_ROW_CHECK" == "1" ]] && echo pass || echo fail)"

  if [[ "$RESTORE_OK" -eq 1 ]] && drillPassed "$TABLE_COUNT" "$SAMPLE_ROW_CHECK"; then
    log "PASS: Restore drill succeeded for $SERVICE"
    OUTCOMES[$SERVICE]="success"
  else
    log "FAIL: Restore drill failed for $SERVICE"
    OUTCOMES[$SERVICE]="failed"
  fi

  SAMPLE_ROW_CHECK_STR=$([[ "$SAMPLE_ROW_CHECK" == "1" ]] && echo pass || echo fail)
  SAMPLE_TABLE_JSON="null"
  [[ -n "$SAMPLE_TABLE_NAME" ]] && SAMPLE_TABLE_JSON="\"$(json_escape "$SAMPLE_TABLE_NAME")\""
  SERVICE_JSON_FRAGMENTS+=("\"$(json_escape "$SERVICE")\":{\"outcome\":\"${OUTCOMES[$SERVICE]}\",\"tableCount\":${TABLE_COUNT},\"sampleRowCheck\":\"${SAMPLE_ROW_CHECK_STR}\",\"sampleTable\":${SAMPLE_TABLE_JSON}}")

  run_psql -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" >>"$REPORT" 2>&1 || true
  CURRENT_DRILL_DB=""
done

# ── Aggregate outcomes via the shared pure aggregation rule (Req 12.6 / Property 8) ─────────
# The "critical" list passed to outcome-aggregation.mjs is the set of services actually drilled
# in this run (SERVICES_TO_DRILL) — the full Tier-0/Tier-1 universe by default, or a single
# service when --service is given — so a single-service drill's exit code reflects only that
# service.
OUTCOMES_JSON="{"
FIRST=1
for SERVICE in "${SERVICES_TO_DRILL[@]}"; do
  [[ "$FIRST" -eq 0 ]] && OUTCOMES_JSON+=","
  OUTCOMES_JSON+="\"${SERVICE}\":\"${OUTCOMES[$SERVICE]}\""
  FIRST=0
done
OUTCOMES_JSON+="}"

CRITICAL_LIST=$(IFS=,; echo "${SERVICES_TO_DRILL[*]}")

log "Outcomes: $OUTCOMES_JSON"

set +e
AGGREGATION_JSON=$(echo "$OUTCOMES_JSON" | node "$AGG_LIB" --critical "$CRITICAL_LIST")
AGG_EXIT=$?
set -e
echo "$AGGREGATION_JSON" >>"$REPORT"
log "Aggregation: $AGGREGATION_JSON"

# ── Optional Drill_Report JSON artifact (Req 13.1; consumed by task 16.3's
#    publish-drill-report.mjs and produced in CI by task 16.5's dr-drill.yml) ────────────────
if [[ -n "$REPORT_JSON_PATH" ]]; then
  SERVICES_JSON="{"
  FIRST=1
  for FRAGMENT in "${SERVICE_JSON_FRAGMENTS[@]}"; do
    [[ "$FIRST" -eq 0 ]] && SERVICES_JSON+=","
    SERVICES_JSON+="$FRAGMENT"
    FIRST=0
  done
  SERVICES_JSON+="}"

  node -e '
    const [timestamp, servicesJson, aggregationJson] = process.argv.slice(1);
    const report = {
      timestamp,
      services: JSON.parse(servicesJson),
      aggregation: JSON.parse(aggregationJson),
    };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  ' "$TIMESTAMP" "$SERVICES_JSON" "$AGGREGATION_JSON" >"$REPORT_JSON_PATH"

  log "Drill_Report written to $REPORT_JSON_PATH"
fi

log "Report: $REPORT"
exit "$AGG_EXIT"
