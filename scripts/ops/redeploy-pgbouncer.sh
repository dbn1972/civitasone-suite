#!/usr/bin/env bash
# redeploy-pgbouncer.sh — recreate the civitasone-pgbouncer container from the
# CURRENT infra/docker-compose.yml, and prove real per-service-role auth works
# through it (Issue #2 follow-up to PERF-001).
#
# Background: PR #1098 (2026-09-08, docs/architecture/CONNECTION-BUDGET.md §3)
# already fixed infra/docker-compose.yml's `pgbouncer` service — wildcard
# `[databases] * = ...` routing, plus AUTH_TYPE=scram-sha-256 with
# AUTH_USER/AUTH_QUERY pulling each connecting role's real SCRAM secret from
# pg_authid on demand (no per-role userlist.txt entry, ever — see below). What
# PR #1098 did NOT do is recreate the already-running `civitasone-pgbouncer`
# container: the edoburu/pgbouncer image only regenerates /etc/pgbouncer/*
# from its env vars at container CREATION, not on `docker restart`, so a
# container started before that fix keeps running the old, broken config
# indefinitely regardless of what's committed. Confirmed live 2026-09-22: the
# shared container (created ~3 weeks earlier, i.e. before PR #1098) was still
# serving the pre-fix config (`auth_type = trust`, single `[databases]
# postgres = ...` entry) — this script is the missing "apply it" step, not a
# design change. See the PR this script shipped in for the full investigation
# and live evidence (disposable PgBouncer on a scratch port, 5 real service
# roles against 5 real databases, real row-count queries).
#
# Why no static userlist.txt / hardcoded database list: `auth_type = trust`
# only governs how PgBouncer authenticates the CLIENT to itself — it does
# nothing for PgBouncer's own SERVER-SIDE login to Postgres, and
# civitasone-postgres's pg_hba.conf requires scram-sha-256 for every
# non-local connection. That's the actual failure mode ("trust" authentication
# failed / password authentication failed), independent of whether
# `[databases]` lists every civitas_* database. A hand-maintained per-role
# userlist.txt (58+ entries today, see infra/db/bootstrap/services.json) would
# technically also fix the backend-auth gap, but is exactly the kind of
# hand-maintained list that let PERF-001 regress once already (a fixed
# 33-service constant silently going stale as the fleet grew to 65+) — so
# this repo's committed fix uses auth_query against pg_authid instead: ONE
# bootstrap credential (civitas_admin), zero re-provisioning when a service is
# added or removed. Do not reintroduce a static userlist.txt here.
#
# Safety:
#   - Defaults to a dry run: probes whatever is CURRENTLY listening on
#     --port (default 6432) with real per-role connections, and touches no
#     container. Pass --apply to actually recreate the pgbouncer container.
#   - --apply refuses to proceed if the target port has active (ESTABLISHED)
#     client connections, unless --force is also passed — recreating a
#     container with real clients attached would cut them off mid-session.
#     (At time of writing, 2026-09-22, all 32 running services connect
#     directly to Postgres on :5435 and none use :6432 at all, so this guard
#     is expected to pass cleanly — but it is a live check, not an assumption.)
#   - Never guesses a password for a role outside dev/test. The derived
#     "<role-without-_svc>_dev_pw" convention (ecosystem.config.js's dbUrl()
#     fallback) is only used when NODE_ENV/RUNTIME_NODE_ENV is development or
#     test (mirrors ecosystem.config.js's own IS_PROD_FALLBACK_ALLOWED_ENVS).
#     Otherwise, supply each role's real password via `{ROLE_UPPER}_PASSWORD`
#     env vars (the same naming infra/db/bootstrap/gen_bootstrap.mjs already
#     uses) — a role with no password available is reported SKIPPED, never
#     guessed.
#
# Usage:
#   scripts/ops/redeploy-pgbouncer.sh                       # probe :6432, every DB-backed service, no changes
#   scripts/ops/redeploy-pgbouncer.sh --port 16432          # probe some other port (e.g. a scratch container)
#   scripts/ops/redeploy-pgbouncer.sh --apply               # recreate civitasone-pgbouncer, then probe it
#   scripts/ops/redeploy-pgbouncer.sh --apply --force        # skip the active-connection guard
#   scripts/ops/redeploy-pgbouncer.sh --sample 5             # quick smoke check: only the first 5 services
#
# A handful of services fail for reasons that are pre-existing and unrelated to
# PgBouncer routing (confirmed while developing this script — see the PR it
# shipped in): some ecosystem.config.js entries have no bootstrapped database
# yet ("database ... does not exist"), and a few roles' real Postgres passwords
# don't follow the "<role>_dev_pw" convention ("SASL authentication failed"
# despite the role/database both existing). Both are reported as FAIL, on
# purpose — this script's job is to say what's actually true, not to hide
# unrelated gaps behind a filtered success count.
#
# Enumeration comes from scripts/ops/lib/fleet-topology.mjs's loadFleetTopology()
# — the same live-derived-from-ecosystem.config.js source verify-pgbouncer-routing.mjs
# already uses — never a list hand-copied into this script. (infra/db/bootstrap/
# services.json looks like the same kind of thing but is NOT: it only covers the
# original 9 hand-authored bootstrap entries, not the 50+ added later via
# bootstrap_new_services.sql / bootstrap_missing_services.sql / etc — confirmed
# while developing this script, see the PR it shipped in.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FLEET_TOPOLOGY_MJS="${SCRIPT_DIR}/lib/fleet-topology.mjs"

CONTAINER="${PGBOUNCER_CONTAINER:-civitasone-pgbouncer}"
HOST="${PGBOUNCER_HOST:-localhost}"
PORT="${PGBOUNCER_PORT:-6432}"
SAMPLE="all"
APPLY=0
FORCE=0
# Where the live stack's docker-compose.yml + .env actually live. This is
# deliberately NOT assumed to be $REPO_ROOT: on the host this was written on,
# the checkout that created the running containers (per `docker inspect
# civitasone-pgbouncer --format '{{index .Config.Labels
# "com.docker.compose.project.working_dir"}}'`) is a SEPARATE clone from the
# one this script ships in. Always re-check with the docker inspect command
# above before trusting the default — don't assume your dev checkout is the
# deployment checkout.
COMPOSE_DIR="${PGBOUNCER_COMPOSE_DIR:-}"

log() { echo "[$(date -u +%H:%M:%S)] $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --force) FORCE=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --compose-dir) COMPOSE_DIR="$2"; shift 2 ;;
    --sample) SAMPLE="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$FLEET_TOPOLOGY_MJS" ]]; then
  log "FATAL: $FLEET_TOPOLOGY_MJS not found (expected the fleet enumeration source of truth)"
  exit 2
fi

# ── 1. Safety guard for --apply: refuse to recreate a container with live clients ──
check_active_connections() {
  local port="$1"
  # ESTABLISHED connections with the target port as local (server) port.
  ss -tn 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" && $1=="ESTAB" {print}'
}

if [[ "$APPLY" -eq 1 ]]; then
  if [[ -z "$COMPOSE_DIR" ]]; then
    log "FATAL: --apply requires --compose-dir (or PGBOUNCER_COMPOSE_DIR) pointing at the"
    log "       directory docker compose actually deployed from. Find it with:"
    log "       docker inspect $CONTAINER --format '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}'"
    exit 2
  fi
  if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
    log "FATAL: $COMPOSE_DIR/docker-compose.yml not found"
    exit 2
  fi

  active="$(check_active_connections "$PORT" || true)"
  if [[ -n "$active" && "$FORCE" -ne 1 ]]; then
    log "REFUSING to recreate: active ESTABLISHED connections on port $PORT:"
    echo "$active" >&2
    log "Pass --force to override (will cut these connections)."
    exit 1
  fi
  if [[ -n "$active" ]]; then
    log "WARNING: proceeding with --force despite active connections on port $PORT"
  else
    log "OK: no active client connections on port $PORT"
  fi

  log "Recreating $CONTAINER from $COMPOSE_DIR/docker-compose.yml ..."
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate pgbouncer )

  log "Waiting for healthcheck..."
  for _ in $(seq 1 30); do
    status="$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")"
    [[ "$status" == "healthy" ]] && break
    sleep 1
  done
  log "Container health: ${status:-unknown}"
fi

# ── 2. Probe: real connections through PgBouncer as real service roles ─────────
IS_DEV_LIKE=0
case "${RUNTIME_NODE_ENV:-${NODE_ENV:-}}" in
  development|test) IS_DEV_LIKE=1 ;;
esac

# loadFleetTopology().services -> "dbUser dbName" lines, sorted by name (same
# order fleet-topology.mjs itself returns), via node's ESM dynamic import (no
# new dependency — matches verify-pgbouncer-routing.mjs's own "shell out,
# don't add a pg client lib to a bare scripts/ tree" reasoning).
mapfile -t ALL_PAIRS < <(node -e '
  import(process.argv[1]).then(m => {
    const t = m.loadFleetTopology();
    for (const s of t.services) console.log(`${s.dbUser} ${s.dbName}`);
  });
' "$FLEET_TOPOLOGY_MJS")

if [[ "$SAMPLE" == "all" ]]; then
  PAIRS=("${ALL_PAIRS[@]}")
else
  PAIRS=("${ALL_PAIRS[@]:0:$SAMPLE}")
fi

log "Probing ${#PAIRS[@]} of ${#ALL_PAIRS[@]} service(s) through ${HOST}:${PORT} ..."

fail_count=0
skip_count=0
for pair in "${PAIRS[@]}"; do
  role="${pair%% *}"
  db="${pair##* }"
  role_upper="$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  pw_var="${role_upper}_PASSWORD"
  pw="${!pw_var:-}"

  if [[ -z "$pw" && "$IS_DEV_LIKE" -eq 1 ]]; then
    pw="${role/_svc/_dev_pw}"
  fi

  if [[ -z "$pw" ]]; then
    log "SKIP  $role @ $db — no $pw_var and not a dev/test environment (refusing to guess a password)"
    skip_count=$((skip_count + 1))
    continue
  fi

  result="$(PGPASSWORD="$pw" psql "host=$HOST port=$PORT user=$role dbname=$db sslmode=disable" \
    -tAc "SELECT current_user, current_database(), count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" 2>&1)" \
    && ok=1 || ok=0

  if [[ "$ok" -eq 1 && "$result" == "$role|$db|"* ]]; then
    log "PASS  $role @ $db -> $result"
  else
    log "FAIL  $role @ $db -> $result"
    fail_count=$((fail_count + 1))
  fi
done

log "Done: $((${#PAIRS[@]} - fail_count - skip_count)) passed, $fail_count failed, $skip_count skipped"
[[ "$fail_count" -eq 0 ]] || exit 1
