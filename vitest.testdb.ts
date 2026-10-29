/**
 * Test-database resolution: tests never default to a live database.
 *
 * CI's `Tests` job runs Postgres on host port 5435 and exports PGHOST/PGPORT/
 * PGUSER/PGPASSWORD at job level (.github/workflows/ci.yml). Tests and vitest
 * configs used to hard-code that same `localhost:5435` as their fallback. On a
 * shared dev/UAT host, 5435 is the LIVE database (and 6432 the pgbouncer in
 * front of it), so a run with no DB env silently wrote to live data (FQ15).
 *
 * Rule: a test, test setup or vitest config may only connect to a database it
 * was explicitly given. Host and port come from PGHOST/PGPORT (or the suite's
 * own *_DATABASE_URL); when they are missing we THROW instead of guessing.
 * CI is unchanged: it already sets PGHOST=localhost and PGPORT=5435, so every
 * derived DSN is byte-identical to the old literal there.
 *
 * Enforced by tests/architecture/no-live-db-default-guard.test.ts.
 * Imported by relative path from configs and tests, like ./vitest.drain.ts.
 */

export const TEST_DB_NOT_CONFIGURED =
  "test DB not configured: set PGHOST/PGPORT/PGUSER/PGPASSWORD (or the suite's *_DATABASE_URL) " +
  "to a disposable Postgres (refusing to default to a live database)";

export interface TestDb {
  host: string;
  port: string;
}

/** PGHOST/PGPORT when both are set, otherwise null. Never a default. */
export function testDbFromEnv(env: NodeJS.ProcessEnv = process.env): TestDb | null {
  const host = env.PGHOST?.trim();
  const port = env.PGPORT?.trim();
  return host && port ? { host, port } : null;
}

/** True when PGHOST/PGPORT are set. For suites that are already env-gated (skipIf). */
export function hasTestDb(env: NodeJS.ProcessEnv = process.env): boolean {
  return testDbFromEnv(env) !== null;
}

/** PGHOST/PGPORT, or throw the "test DB not configured" error. */
export function requireTestDb(env: NodeJS.ProcessEnv = process.env): TestDb {
  const db = testDbFromEnv(env);
  if (!db) throw new Error(TEST_DB_NOT_CONFIGURED);
  return db;
}

/** `${PGHOST}:${PGPORT}` for building a DSN, or throw. */
export function testDbHostPort(env: NodeJS.ProcessEnv = process.env): string {
  const { host, port } = requireTestDb(env);
  return `${host}:${port}`;
}
