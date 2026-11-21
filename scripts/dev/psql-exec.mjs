/**
 * Shared psql invocation for migrate-all.mjs / seed-all.mjs.
 *
 * Default (local dev): run psql inside the compose container `civitasone-postgres`.
 * CIVITAS_PSQL_MODE=compose (install.sh): run psql via `docker compose -p $COMPOSE_PROJECT_NAME exec postgres`,
 * so the target is always that project's own postgres (user: CIVITAS_PSQL_USER, default civitas_admin).
 * CI (CIVITAS_PSQL_MODE=host): the Postgres is a GitHub service container with a
 * generated name, reachable on PGHOST:PGPORT, so use the host psql client as the
 * PGUSER bootstrap SUPERUSER. The CI civitas_admin role is deliberately
 * NOSUPERUSER/NOBYPASSRLS and cannot create schemas or seed RLS-protected tables.
 */
export function psqlInvocation(db) {
  // Fail closed under the installer: install.sh exports CIVITAS_PSQL_REQUIRE_MODE=1,
  // meaning "the only acceptable target is the installer's own compose project".
  // Never fall back to the hard-coded `civitasone-postgres` container (which may be
  // an unrelated live database on a shared host). Standalone dev callers don't set
  // this and keep the old default.
  if (process.env.CIVITAS_PSQL_REQUIRE_MODE === "1" && process.env.CIVITAS_PSQL_MODE !== "compose") {
    throw new Error(
      "CIVITAS_PSQL_REQUIRE_MODE=1 but CIVITAS_PSQL_MODE is " +
      JSON.stringify(process.env.CIVITAS_PSQL_MODE ?? null) +
      " (must be \"compose\"); refusing to fall back to a hard-coded postgres container",
    );
  }
  if (process.env.CIVITAS_PSQL_MODE === "compose") {
    // Installer mode: talk ONLY to the postgres service of an explicit compose
    // project, never to a hard-coded container name that may belong to another
    // stack on a shared host. Refuses to run without an explicit project.
    const project = process.env.COMPOSE_PROJECT_NAME;
    if (!project) {
      throw new Error("CIVITAS_PSQL_MODE=compose requires COMPOSE_PROJECT_NAME (refusing to guess a target)");
    }
    const composeFile = process.env.CIVITAS_COMPOSE_FILE ?? "infra/docker-compose.prod.yml";
    const envFile = process.env.CIVITAS_COMPOSE_ENV_FILE ?? "infra/.env";
    const user = process.env.CIVITAS_PSQL_USER ?? "civitas_admin";
    return {
      file: "docker",
      args: [
        "compose", "-p", project, "-f", composeFile, "--env-file", envFile,
        "exec", "-T", "postgres", "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1",
      ],
      env: process.env,
    };
  }
  if (process.env.CIVITAS_PSQL_MODE === "host") {
    const host = process.env.PGHOST ?? "localhost";
    const port = process.env.PGPORT ?? "5432";
    const user = process.env.PGUSER ?? "civitas";
    return {
      file: "psql",
      args: ["-h", host, "-p", String(port), "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1"],
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "" },
    };
  }
  return {
    file: "docker",
    args: ["exec", "-i", "civitasone-postgres", "psql", "-U", "civitas_admin", "-d", db, "-v", "ON_ERROR_STOP=1"],
    env: process.env,
  };
}
