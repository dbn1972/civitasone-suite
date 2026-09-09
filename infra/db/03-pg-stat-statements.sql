-- PERF-010: mirrors infra/db/bootstrap/bootstrap_pg_stat_statements.sql for
-- the production docker-compose path. docker-entrypoint-initdb.d scripts run
-- once, as the POSTGRES_USER superuser, against POSTGRES_DB, only when the
-- data directory is first initialized (same rule the two scripts ahead of
-- this one already rely on). Requires the postgres service's `command:` to
-- set shared_preload_libraries=pg_stat_statements (see infra/docker-compose.prod.yml)
-- -- that is a postmaster-start-time GUC and cannot be turned on from SQL.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
