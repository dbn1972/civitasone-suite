/**
 * PERF-008 — live-Postgres regression coverage for the new schema_version
 * column.
 *
 * Mirrors purge-live-pg.test.ts's convention (real disposable Postgres, not
 * a mock) because the thing actually at risk here is a real DB round-trip: a
 * mocked `tx.insert().values()` would happily accept whatever object shape
 * enqueue() builds, whether or not the real `_outbox.messages` table's
 * `schema_version` column genuinely exists / genuinely defaults / genuinely
 * round-trips a non-default value back out unchanged. Only a real INSERT +
 * SELECT against a real Postgres proves that.
 *
 * Requires DATABASE_URL to point at a disposable/test Postgres with the
 * CURRENT `_outbox.messages` schema applied — i.e. this package's own
 * migrations, including 0001_init.sql (or equivalent) AND
 * NNNN_perf008_outbox_schema_version.sql's `schema_version` column (see any
 * service's migrations/ for the exact DDL, or run
 * scripts/ci/bootstrap-postgres.sh against a disposable container).
 *
 * Skips cleanly when DATABASE_URL is unset, same as purge-live-pg.test.ts.
 *
 * Deliberately does NOT `TRUNCATE _outbox.messages` (unlike purge-live-pg.test.ts,
 * which owns the whole table for its own run). vitest runs different test
 * FILES concurrently by default, and a blanket TRUNCATE from this file racing
 * against purge-live-pg.test.ts's own in-progress 10,050-row bulk insert
 * silently wiped out a chunk of it mid-loop — reproduced live: the full
 * `pnpm exec vitest run` suite failed purge-live-pg.test.ts's row-count
 * assertion (9,052 instead of 10,050) while that same file passed clean 100%
 * of the time in isolation (`vitest run tests/purge-live-pg.test.ts`). Every
 * row this file writes carries a `perf008.test.*` topic prefix found nowhere
 * else in this package's tests, so scoping cleanup to that prefix (DELETE,
 * not TRUNCATE) makes this file's tests self-isolating without needing the
 * whole table to itself.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { enqueue, type DrizzleTx } from "../src/index.js";
import { DEFAULT_SCHEMA_VERSION } from "../src/schema-versions.js";

const DATABASE_URL = process.env.DATABASE_URL;
const client = DATABASE_URL ? postgres(DATABASE_URL) : null;
const db = client ? (drizzle(client) as unknown as DrizzleTx) : null;

async function deleteOwnRows(): Promise<void> {
  await client!`DELETE FROM _outbox.messages WHERE topic LIKE 'perf008.test.%'`;
}

// FLAKY-SKIP: Requires DATABASE_URL against a real Postgres with the PERF-008 schema_version column applied; unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!DATABASE_URL)("enqueue() schema_version — live Postgres (PERF-008)", () => {
  beforeEach(async () => {
    await deleteOwnRows();
  });

  afterAll(async () => {
    await deleteOwnRows();
    await client?.end({ timeout: 0 });
  });

  it("persists DEFAULT_SCHEMA_VERSION when the caller omits schemaVersion (registry currently empty)", async () => {
    await enqueue(db!, {
      topic: "perf008.test.default",
      eventType: "perf008.test.default.happened",
      tenantId: crypto.randomUUID(),
      actorId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      payload: { ok: true },
    });

    const [row] = await client!`SELECT schema_version FROM _outbox.messages WHERE topic = 'perf008.test.default'`;
    expect(row?.schema_version).toBe(DEFAULT_SCHEMA_VERSION);
  });

  it("persists an explicit schemaVersion when the caller passes one, overriding the registry default", async () => {
    await enqueue(db!, {
      topic: "perf008.test.explicit",
      eventType: "perf008.test.explicit.happened",
      tenantId: crypto.randomUUID(),
      actorId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      payload: { ok: true },
      schemaVersion: "3.2",
    });

    const [row] = await client!`SELECT schema_version FROM _outbox.messages WHERE topic = 'perf008.test.explicit'`;
    expect(row?.schema_version).toBe("3.2");
  });

  it("two different topics enqueued in the same batch can carry different versions independently", async () => {
    await enqueue(db!, {
      topic: "perf008.test.multi.a", eventType: "a", tenantId: crypto.randomUUID(),
      actorId: crypto.randomUUID(), correlationId: crypto.randomUUID(), payload: {},
      schemaVersion: "1.0",
    });
    await enqueue(db!, {
      topic: "perf008.test.multi.b", eventType: "b", tenantId: crypto.randomUUID(),
      actorId: crypto.randomUUID(), correlationId: crypto.randomUUID(), payload: {},
      schemaVersion: "2.0",
    });

    const rows = await client!`SELECT topic, schema_version FROM _outbox.messages WHERE topic LIKE 'perf008.test.multi.%' ORDER BY topic`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ topic: "perf008.test.multi.a", schema_version: "1.0" });
    expect(rows[1]).toMatchObject({ topic: "perf008.test.multi.b", schema_version: "2.0" });
  });
});
