/**
 * Shared support for the two real-DB cross-events integration tests
 * (municipal-status-notification-integration, municipal-fee-challan-integration).
 *
 * Root cause of their intermittent CI failures ("notification-service must
 * have written a delivery row: expected 0 to be greater than 0", and the
 * fee-challan sibling): @civitasone/outbox's relayOnce() claims EVERY
 * unpublished row in the service's outbox (no tenant/topic filter, oldest
 * first, batch-limited), and both files use the same tenant and the same
 * vendor outbox while vitest runs files in parallel. Whichever file called
 * relayOnce first published BOTH files' rows onto its own queue (where the
 * other file's consumers are not subscribed) and marked them published, so
 * the other file's rows were never delivered to its consumers. Rows left over
 * by other test files (registrations, number-sequences, ...) could also push a
 * test's own row past the 100-row batch limit.
 *
 * Fix: (1) serialise the two files with a Postgres advisory lock held on a
 * dedicated connection for the whole test, (2) drain the outbox in a loop so
 * leftover rows from other files cannot starve the test's own row.
 */
import postgres from "postgres";
import { relayOnce } from "@civitasone/outbox";

// Arbitrary constant, namespaced to this suite.
const LOCK_KEY = 7_319_204_411;

export async function acquireOutboxRelayLock(): Promise<() => Promise<void>> {
  const conn = postgres(process.env.DATABASE_URL!, { max: 1 });
  await conn`SELECT pg_advisory_lock(${LOCK_KEY})`;
  return async () => {
    try {
      await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    } finally {
      await conn.end();
    }
  };
}

/** Relay until the outbox has no unpublished rows left; returns the total published. */
export async function relayAll(db: never, queue: never, service: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const n = await relayOnce(db, queue, 100, service);
    if (n === 0) break;
    total += n;
  }
  return total;
}
