import postgres from "postgres";
import { afterEach, beforeEach } from "vitest";

/**
 * Cross-process mutual exclusion for tests that relay finance-service's outbox.
 *
 * Several services' cross-service tests (advertisement, animal, building, event,
 * parking, roadcut, shop, trade, the municipal pairs, finance's own) share ONE
 * civitas_finance database, and each calls relayOnce()/relayAll() on it. relayOnce
 * reads EVERY unpublished row, whoever enqueued it, so a test running in another
 * process (turbo runs the services' suites in parallel) can publish this test's
 * finance.gl.post row into ITS queue first. The victim then relays 0 rows and fails
 * "expected 0 to be >= 1" although nothing is wrong with the code under test.
 *
 * Call once at module scope of such a test file. Each test then holds a Postgres
 * advisory lock (on a dedicated session, released when the connection ends) for its
 * whole duration, so only one process at a time has rows in flight in that outbox.
 */
const LOCK_KEY = "7262026001";

export function serializeFinanceOutboxRelay(dsn: string): void {
  let conn: ReturnType<typeof postgres> | undefined;
  beforeEach(async () => {
    conn = postgres(dsn, { max: 1, onnotice: () => {} });
    await conn`select pg_advisory_lock(${LOCK_KEY}::bigint)`;
  }, 180_000);
  afterEach(async () => {
    const c = conn;
    conn = undefined;
    if (c) await c.end({ timeout: 5 });
  });
}
