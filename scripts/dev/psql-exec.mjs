/**
 * Shared psql invocation for migrate-all.mjs / seed-all.mjs.
 *
 * Default (local dev): run psql inside the compose container `civitasone-postgres`.
 * CI (CIVITAS_PSQL_MODE=host): the Postgres is a GitHub service container with a
 * generated name, reachable on PGHOST:PGPORT, so use the host psql client as the
 * PGUSER bootstrap SUPERUSER. The CI civitas_admin role is deliberately
 * NOSUPERUSER/NOBYPASSRLS and cannot create schemas or seed RLS-protected tables.
 */
export function psqlInvocation(db) {
  if (process.env.CIVITAS_PSQL_MODE === "host") {
    const host = process.env.PGHOST ?? "localhost";
    const port = process.env.PGPORT ?? "5432";
    const user = process.env.PGUSER ?? "civitas";
    return {
      cmd: `psql -h ${host} -p ${port} -U ${user} -d ${db} -v ON_ERROR_STOP=1`,
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "" },
    };
  }
  return {
    cmd: `docker exec -i civitasone-postgres psql -U civitas_admin -d ${db} -v ON_ERROR_STOP=1`,
    env: process.env,
  };
}
