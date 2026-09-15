/**
 * REL-029 — live-Postgres regression coverage.
 *
 * `startOutboxPurge`'s stuck-outbox WARN (src/index.ts) reads the result of
 * a raw `db.execute(sql\`SELECT count(*)...\`)` call as
 * `(result).rows?.[0]?.cnt ?? 0`. drizzle's postgres-js driver returns a
 * bare array of rows for a raw `db.execute()` SELECT, not a
 * `{ rows: [...] }` wrapper — so that read always fell through to `?? 0`
 * regardless of the real count, and the ">10K stuck outbox" WARN could
 * never fire no matter how backed up the outbox actually got.
 *
 * purge.test.ts's mocks encoded that exact same wrong `{ rows: [...] }`
 * shape (see its git history) — which is exactly why the bug shipped past
 * unit tests undetected: a mocked return shape can be self-consistently
 * wrong in precisely the way the real driver isn't. This file seeds a REAL
 * backlog past the 10K threshold into a REAL Postgres and asserts the WARN
 * fires against the actual driver's actual return shape — not a mock.
 *
 * Requires DATABASE_URL to point at a disposable/test Postgres with the
 * `_outbox` schema applied (see `outboxMessages`/`processed` in
 * ../src/index.ts for the exact column set: e.g.
 *   CREATE SCHEMA _outbox; CREATE SCHEMA _inbox;
 *   CREATE TABLE _outbox.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     topic varchar(128) NOT NULL, event_type varchar(128) NOT NULL,
 *     tenant_id uuid NOT NULL, actor_id uuid NOT NULL,
 *     correlation_id varchar(64) NOT NULL,
 *     -- PERF-008: schema_version has a DEFAULT, so it's optional at INSERT time too.
 *     schema_version varchar(16) NOT NULL DEFAULT '1.0',
 *     payload jsonb NOT NULL,
 *     created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz);
 *   CREATE TABLE _inbox.processed (message_id uuid PRIMARY KEY,
 *     processed_at timestamptz NOT NULL DEFAULT now());
 *
 * Skips cleanly when DATABASE_URL is unset so `pnpm test` stays green
 * without live infra wired up. Deliberately does NOT default DATABASE_URL
 * to any shared/persistent instance (unlike some services' vitest.config.ts,
 * which default to the CI-provisioned localhost:5435) — this package's own
 * suite has never needed a live database, so no per-package test database
 * is provisioned anywhere yet. Point DATABASE_URL at a throwaway container.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { startOutboxPurge, type DrizzleTx } from "../src/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const client = DATABASE_URL ? postgres(DATABASE_URL) : null;
const db = client ? (drizzle(client) as unknown as DrizzleTx) : null;

type WarnCall = [Record<string, unknown>, string];

function seedRows(n: number, prefix: string): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    topic: "test.topic",
    event_type: "test.event",
    tenant_id: crypto.randomUUID(),
    actor_id: crypto.randomUUID(),
    correlation_id: `${prefix}-${i}`,
    payload: {},
  }));
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000, stepMs = 50): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

// FLAKY-SKIP: Requires DATABASE_URL against a real Postgres for the REL-029 live-purge path; unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!DATABASE_URL)("startOutboxPurge — live Postgres (REL-029)", () => {
  beforeEach(async () => {
    await client!`TRUNCATE _outbox.messages`;
  });

  afterAll(async () => {
    await client?.end({ timeout: 0 });
  });

  it("fires the WARN once a real backlog past 10,000 unpublished rows sits in Postgres", async () => {
    // published_at IS NULL on every row -- purgeOutbox's DELETE only targets
    // `published_at IS NOT NULL AND published_at < cutoff`, so none of these
    // are ever eligible for deletion. A purge cycle genuinely deletes 0 rows
    // here (an authentically empty DELETE, not a rowCount misread), which is
    // exactly the real-world "stuck outbox" condition the WARN exists for.
    const BACKLOG = 10_050;
    const BATCH = 1000;
    for (let inserted = 0; inserted < BACKLOG; inserted += BATCH) {
      const n = Math.min(BATCH, BACKLOG - inserted);
      const rows = seedRows(n, `rel029-${inserted}`);
      await client!`INSERT INTO _outbox.messages ${client!(rows, "topic", "event_type", "tenant_id", "actor_id", "correlation_id", "payload")}`;
    }

    const [{ count }] = await client!`SELECT count(*)::int AS count FROM _outbox.messages`;
    expect(count).toBe(BACKLOG);

    const calls: WarnCall[] = [];
    const timer = startOutboxPurge(db!, {
      intervalMs: 50,
      batchSize: BATCH,
      logger: { warn: (obj, msg) => calls.push([obj, msg]) },
    });
    try {
      await waitFor(() => calls.length > 0);
    } finally {
      clearInterval(timer);
    }

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const [warnObj, warnMsg] = calls[0]!;
    // This is the assertion that fails against the pre-fix code: the buggy
    // `.rows?.[0]?.cnt ?? 0` read means outboxCount is always 0 there, and
    // `0 > 10_000` is false, so the WARN never fires and `calls` stays empty
    // (the waitFor above times out instead of reaching this point).
    expect(warnObj).toMatchObject({ outboxCount: BACKLOG, deleted: 0 });
    expect(warnMsg).toContain("outbox purge deleted zero rows");
  }, 20_000);

  it("does not fire the WARN once the backlog is genuinely purged below the threshold", async () => {
    // Opposite-direction sanity check: published, retention-eligible rows
    // actually get deleted, so deleted !== 0 and the WARN branch (which only
    // runs when deleted === 0) never even queries the count.
    const rows = seedRows(20, "rel029-old");
    await client!`INSERT INTO _outbox.messages ${client!(rows, "topic", "event_type", "tenant_id", "actor_id", "correlation_id", "payload")}`;
    await client!`UPDATE _outbox.messages SET published_at = now() - interval '30 days'`;

    const calls: WarnCall[] = [];
    const timer = startOutboxPurge(db!, {
      intervalMs: 50,
      retentionDays: 7,
      batchSize: 1000,
      logger: { warn: (obj, msg) => calls.push([obj, msg]) },
    });
    try {
      // No positive event to poll for here (we're asserting an absence), so
      // just give a handful of real 50ms cycles a chance to run.
      await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      clearInterval(timer);
    }

    const [{ count }] = await client!`SELECT count(*)::int AS count FROM _outbox.messages`;
    expect(count).toBe(0);
    expect(calls).toHaveLength(0);
  }, 20_000);
});
