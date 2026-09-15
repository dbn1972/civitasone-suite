#!/usr/bin/env bash
# migrate-rollback.sh — REL-020: roll back one service's most recently
# applied migration.
#
# THE GAP THIS CLOSES: every service's migrations/ directory (67 services,
# scripts/dev/migrate-all.mjs + scripts/ci/bootstrap-postgres.sh) is a set of
# hand-written, idempotent, forward-only *.sql files applied in filename
# order via plain `psql -f`. There is no schema_migrations/ledger table
# anywhere in this codebase (confirmed by grep across packages/, scripts/,
# infra/) and no down-migrations existed before this change (confirmed by
# grep across every services/*/migrations/) -- only forward migration was
# possible. This script, plus the services/<name>/migrations/down/*.sql
# convention it reads from, is the rollback half.
#
# "MOST RECENTLY APPLIED" WITHOUT A LEDGER: since nothing tracks which
# migrations have actually run against a given database, this tool infers it
# the same way the fleet's own forward tooling already treats "current
# state" -- the highest-numbered *.sql file directly in migrations/ (not
# recursive, so it never sees migrations/down/ itself). That is exactly what
# scripts/dev/migrate-all.mjs's readdirSync and bootstrap-postgres.sh's
# `find "$mig_dir" -maxdepth 1 -name '*.sql'` already assume when they
# forward-apply "everything in order". If a service numbers migrations
# non-sequentially (tenant-service has two 0015_*.sql files; location-service
# has 0005/0005a/0005b) this tool refuses to guess and requires --migration
# instead -- see the DUP_COUNT guard below. If a database is known to be
# behind (some migrations never applied), don't trust the default either --
# pass --migration explicitly.
#
# SAFETY MODEL: the down-migration is applied with `psql -1` (single
# transaction) and `-v ON_ERROR_STOP=1`. If the down-migration's target
# objects don't actually exist (e.g. because the up-migration this claims to
# reverse was never applied), the failing statement aborts the whole
# transaction and NOTHING is committed -- verified empirically, see
# scripts/ops/MIGRATION-ROLLBACK.md's "Verification" section. A schema-only
# pg_dump snapshot is also taken first (best-effort convenience, not the
# actual safety mechanism) so a human has something to diff against.
#
# USAGE
#   scripts/ops/migrate-rollback.sh --service <name> [options]
#
# OPTIONS
#   --service NAME     Required. e.g. identity-service
#   --migration NAME   Basename (no .sql) of the migration to roll back.
#                       Default: highest-numbered file in migrations/.
#   --role ROLE        Override the DB role to run as (default: derived,
#                       see below). Needed for ADMIN_OWNED_DBS services
#                       (court/inspection/ml/revenue/works-service --
#                       civitas_admin owns their schemas, not <svc>_svc).
#   --db NAME          Override the target database name (default: derived).
#   --password PW      Override the DB password (default: derived dev
#                       convention, or $PGPASSWORD if set).
#   --list             Print every migration for --service and whether a
#                       down-migration exists for it yet. No DB connection.
#   --dry-run          Print what would run (service/migration/db/role, and
#                       the down-migration's SQL) without connecting.
#   --yes              Skip the interactive confirmation prompt.
#   --no-backup        Skip the pre-rollback schema-only pg_dump snapshot.
#
# ENV VARS (same convention as scripts/ci/bootstrap-postgres.sh)
#   PGHOST (default localhost)  PGPORT (default 5435)
#   PGUSER (superuser, default civitas -- only used if the down-migration
#           itself creates/alters a role)
#   PGPASSWORD, BACKUP_DIR (default ~/civitas-backups)
#
# DEFAULT ROLE/DB DERIVATION
#   Matches every entry in bootstrap-postgres.sh's SERVICE_DBS map:
#     base  = <service name>, "-service" suffix stripped, "-" -> "_"
#     role  = "${base}_svc"          e.g. identity-service -> identity_svc
#     db    = "civitas_${base}"      e.g. identity-service -> civitas_identity
#     pw    = "${base}_dev_pw"       (bootstrap-postgres.sh's own convention:
#                                     sed 's/_svc/_dev_pw/' on the role name)
#   This is a *dev/CI* convention. In a real environment, pass --password (or
#   set PGPASSWORD) explicitly -- never rely on the derived dev password.
#
# EXAMPLES
#   scripts/ops/migrate-rollback.sh --service vendor-service --list
#   scripts/ops/migrate-rollback.sh --service vendor-service --dry-run
#   PGHOST=localhost PGPORT=5499 scripts/ops/migrate-rollback.sh \
#     --service vendor-service --yes
#
# See scripts/ops/MIGRATION-ROLLBACK.md for the full procedure, the rollout
# plan for authoring down-migrations for the rest of the fleet, and the
# apply/rollback/re-apply verification this was tested against.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

usage() {
  # Prints this file's own leading comment block (stops at the first
  # non-comment line, i.e. `set -euo pipefail`) so the header above never
  # drifts out of sync with --help output.
  awk '/^#!/{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
}

SERVICE=""
MIGRATION=""
ROLE_OVERRIDE=""
DB_OVERRIDE=""
PASSWORD_OVERRIDE=""
YES=0
DRY_RUN=0
NO_BACKUP=0
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --service) SERVICE="${2:?--service needs a value}"; shift 2 ;;
    --migration) MIGRATION="${2:?--migration needs a value}"; shift 2 ;;
    --role) ROLE_OVERRIDE="${2:?--role needs a value}"; shift 2 ;;
    --db) DB_OVERRIDE="${2:?--db needs a value}"; shift 2 ;;
    --password) PASSWORD_OVERRIDE="${2:?--password needs a value}"; shift 2 ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[ -n "$SERVICE" ] || { echo "ERROR: --service is required" >&2; usage; exit 2; }

MIG_DIR="$ROOT/services/$SERVICE/migrations"
DOWN_DIR="$MIG_DIR/down"

[ -d "$MIG_DIR" ] || { echo "ERROR: no migrations directory for service '$SERVICE' at $MIG_DIR" >&2; exit 1; }

if [ "$LIST" -eq 1 ]; then
  echo "Rollback coverage for $SERVICE ($MIG_DIR):"
  found_any=0
  while IFS= read -r f; do
    found_any=1
    base="$(basename "$f" .sql)"
    if [ -f "$DOWN_DIR/$base.sql" ]; then
      echo "  [down available]    $base"
    else
      echo "  [no down authored]  $base"
    fi
  done < <(find "$MIG_DIR" -maxdepth 1 -name '*.sql' | sort)
  [ "$found_any" -eq 1 ] || echo "  (no migrations found)"
  exit 0
fi

# ── Resolve target migration ────────────────────────────────────────────
if [ -z "$MIGRATION" ]; then
  mapfile -t FILES < <(find "$MIG_DIR" -maxdepth 1 -name '*.sql' | sort)
  [ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no *.sql migrations found in $MIG_DIR" >&2; exit 1; }

  # Refuse to guess when numbering is non-sequential (duplicate leading
  # number across files -- see header comment). Better to make the operator
  # be explicit than silently roll back the wrong migration.
  DUP_COUNT=$(printf '%s\n' "${FILES[@]}" | xargs -n1 basename \
    | sed -E 's/^([0-9]+).*/\1/' | sort | uniq -d | wc -l | tr -d ' ')
  if [ "$DUP_COUNT" -gt 0 ]; then
    echo "ERROR: $SERVICE has more than one migration file sharing the same" >&2
    echo "  leading number -- refusing to guess which is 'most recently" >&2
    echo "  applied'. Pass --migration <basename> explicitly. Run with" >&2
    echo "  --list to see every migration for this service." >&2
    exit 1
  fi

  LATEST="${FILES[${#FILES[@]}-1]}"
  MIGRATION="$(basename "$LATEST" .sql)"
  echo "→ No --migration given; inferred most-recently-applied = $MIGRATION (highest-numbered file in $MIG_DIR)"
fi

UP_FILE="$MIG_DIR/$MIGRATION.sql"
DOWN_FILE="$DOWN_DIR/$MIGRATION.sql"

[ -f "$UP_FILE" ] || { echo "ERROR: $UP_FILE does not exist -- '$MIGRATION' is not a real migration for $SERVICE" >&2; exit 1; }
if [ ! -f "$DOWN_FILE" ]; then
  echo "ERROR: no down-migration authored yet for $SERVICE/$MIGRATION.sql" >&2
  echo "  expected: $DOWN_FILE" >&2
  echo "  This is the expected state for most of the fleet today -- see" >&2
  echo "  scripts/ops/MIGRATION-ROLLBACK.md to author one for this migration." >&2
  exit 1
fi

# ── Resolve DB connection ────────────────────────────────────────────────
BASE="${SERVICE%-service}"
BASE="${BASE//-/_}"
ROLE="${ROLE_OVERRIDE:-${BASE}_svc}"
DB="${DB_OVERRIDE:-civitas_${BASE}}"
PASSWORD="${PASSWORD_OVERRIDE:-${PGPASSWORD:-${ROLE%_svc}_dev_pw}}"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5435}"

# Content-based, mirroring bootstrap-postgres.sh's own needs_superuser(): a
# down-migration that drops/alters a role needs the cluster superuser, not
# the service role. None of this change's 3 down-migrations need it, but a
# future one might (e.g. rolling back a *_scanner_role.sql migration).
needs_superuser() {
  sed 's/--.*$//' "$1" | grep -qiE "(CREATE|ALTER)[[:space:]]+ROLE[[:space:]]+[a-z_]+"
}
RUN_USER="$ROLE"; RUN_PW="$PASSWORD"
if needs_superuser "$DOWN_FILE"; then
  RUN_USER="${PGUSER:-civitas}"
  RUN_PW="${POSTGRES_SUPERUSER_PASSWORD:-${PGPASSWORD:-civitas_test}}"
  echo "→ $MIGRATION's down-migration creates/alters a role; running as superuser $RUN_USER instead of $ROLE"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Service      : $SERVICE"
echo "  Migration    : $MIGRATION  (rolling back)"
echo "  Down file    : $DOWN_FILE"
echo "  Target DB    : $PGHOST:$PGPORT/$DB"
echo "  Running as   : $RUN_USER"
echo "════════════════════════════════════════════════════════════"

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "── DRY RUN: would execute the following (no connection made) ──"
  cat "$DOWN_FILE"
  exit 0
fi

if [ "$YES" -ne 1 ]; then
  read -r -p "Type 'yes' to run this rollback against $PGHOST:$PGPORT/$DB: " CONFIRM
  [ "$CONFIRM" = "yes" ] || { echo "Aborted -- no changes made."; exit 1; }
fi

if [ "$NO_BACKUP" -ne 1 ]; then
  BACKUP_DIR="${BACKUP_DIR:-$HOME/civitas-backups}"
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d%H%M%S)"
  SNAPSHOT="$BACKUP_DIR/rollback-pre-${SERVICE}-${MIGRATION}-${STAMP}.schema.sql"
  echo "→ Taking schema-only safety snapshot: $SNAPSHOT"
  if PGPASSWORD="$RUN_PW" pg_dump -h "$PGHOST" -p "$PGPORT" -U "$RUN_USER" -d "$DB" --schema-only > "$SNAPSHOT" 2>/dev/null; then
    echo "  saved ($(wc -l < "$SNAPSHOT" | tr -d ' ') lines)"
  else
    echo "  ⚠ pg_dump snapshot failed -- proceeding anyway (this snapshot is a" >&2
    echo "    convenience, not the safety mechanism; the transactional apply" >&2
    echo "    below is)." >&2
    rm -f "$SNAPSHOT"
  fi
fi

echo "→ Applying down-migration inside a single transaction (auto-rollback on any error)..."
if PGPASSWORD="$RUN_PW" psql -h "$PGHOST" -p "$PGPORT" -U "$RUN_USER" -d "$DB" \
     -v ON_ERROR_STOP=1 -1 -f "$DOWN_FILE"; then
  echo ""
  echo "✅ Rolled back $SERVICE/$MIGRATION.sql against $PGHOST:$PGPORT/$DB"
  echo "   To re-apply (idempotent, matches this fleet's forward-migration convention):"
  echo "     PGPASSWORD=$RUN_PW psql -h $PGHOST -p $PGPORT -U $RUN_USER -d $DB -v ON_ERROR_STOP=1 -f $UP_FILE"
  exit 0
else
  rc=$?
  echo ""
  echo "❌ Rollback FAILED (exit $rc) -- single-transaction psql (-1) means" >&2
  echo "   NOTHING was committed. $DB is unchanged. See the psql error above." >&2
  exit 1
fi
