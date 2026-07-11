#!/usr/bin/env bash
# court-service runtime integration gate — bootstrap a real Postgres, apply all
# migrations, and prove RLS isolation + the double-booking exclusion constraint
# as the least-privileged (NON-superuser) court_svc role.
#
# Assumes the shared civitasone-postgres container is reachable and its superuser
# is civitas_admin. Override via env: PG_CONTAINER, PG_SUPER, PG_SUPER_PW, SVC_PW.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-civitasone-postgres}"
PG_SUPER="${PG_SUPER:-civitas_admin}"
PG_SUPER_PW="${PG_SUPER_PW:-civitas_dev_pw}"
SVC_PW="${SVC_PW:-court_dev_pw}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../migrations"

super() { docker exec -e PGPASSWORD="$PG_SUPER_PW" "$PG_CONTAINER" psql -U "$PG_SUPER" "$@"; }
svc()   { docker exec -e PGPASSWORD="$SVC_PW"      "$PG_CONTAINER" psql -U court_svc   "$@"; }

echo ">> (re)create role + database"
super -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS civitas_court" \
  -c "DROP ROLE IF EXISTS court_svc" \
  -c "CREATE ROLE court_svc LOGIN PASSWORD '${SVC_PW}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE" \
  -c "CREATE DATABASE civitas_court"

echo ">> extensions"
super -d civitas_court -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS btree_gist" \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"

echo ">> apply migrations"
docker cp "$MIG" "$PG_CONTAINER:/tmp/court-mig"
for f in 0001_court_core 0002_court_scrutiny 0003_court_notice 0004_court_appeal 0005_court_compliance; do
  echo "   - $f"
  super -d civitas_court -v ON_ERROR_STOP=1 -q -f "/tmp/court-mig/$f.sql" >/dev/null
done

echo ">> grant court_svc DML"
super -d civitas_court -v ON_ERROR_STOP=1 \
  -c "GRANT USAGE ON SCHEMA court TO court_svc" \
  -c "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA court TO court_svc"

echo ">> RLS proof (as court_svc)"
docker cp "$HERE/rls_proof.sql" "$PG_CONTAINER:/tmp/rls_proof.sql"
svc -d civitas_court -f /tmp/rls_proof.sql

echo ">> double-booking proof"
docker cp "$HERE/exclude_proof.sql" "$PG_CONTAINER:/tmp/exclude_proof.sql"
super -d civitas_court -v ON_ERROR_STOP=0 -f /tmp/exclude_proof.sql

echo ">> DONE — review output above against integration/README.md expected results"
