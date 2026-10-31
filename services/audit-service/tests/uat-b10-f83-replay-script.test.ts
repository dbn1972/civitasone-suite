/**
 * UAT B10-F83 (review): replay script robustness, against real Postgres.
 *  - lost = message id absent from audit _inbox.processed (no content match,
 *    which suppressed distinct sibling events with the same correlation/target/action);
 *  - a database without _outbox.messages is skipped, not fatal;
 *  - --apply only re-queues the lost rows (published_at = NULL, _replay stamp).
 * Connects as the bootstrap superuser to the disposable test cluster (PGHOST/PGPORT,
 * as CI sets them); REPLAY_TEST_ADMIN_URL_TEMPLATE (DSN with {db}) overrides.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { testDbHostPort } from "../../../vitest.testdb";
import { parseArgs, replayOne } from "../src/scripts/replay-lost-audit-events.js";

const T = process.env.REPLAY_TEST_ADMIN_URL_TEMPLATE ?? `postgres://civitas:civitas_test@${testDbHostPort()}/{db}`;
const TENANT = randomUUID();

describe("replay-lost-audit-events (live Postgres)", () => {
  let producer: postgres.Sql;
  let audit: postgres.Sql;
  let noOutbox: postgres.Sql;
  const ids = { lost1: randomUUID(), lost2: randomUUID(), done: randomUUID(), other: randomUUID(), outside: randomUUID() };
  const corr = randomUUID();

  beforeAll(async () => {
    producer = postgres(T.replace("{db}", "civitas_revenue"), { max: 1 });
    audit = postgres(T.replace("{db}", "civitas_audit"), { max: 1 });
    noOutbox = postgres(T.replace("{db}", "civitas_test"), { max: 1 });
    const ins = (id: string, topic: string, publishedAt: string) => producer`
      INSERT INTO _outbox.messages (id, topic, event_type, tenant_id, actor_id, correlation_id, payload, created_at, published_at)
      VALUES (${id}, ${topic}, ${topic}, ${TENANT}, ${TENANT}, ${corr},
              ${producer.json({ action: "decide", resourceType: "refund", resourceId: "same" })}, ${publishedAt}, ${publishedAt})`;
    // Two distinct sibling events with the same correlation/target/action: both lost.
    await ins(ids.lost1, "audit.event.record", "2026-10-28T19:00:00Z");
    await ins(ids.lost2, "audit.event.record", "2026-10-28T19:00:01Z");
    await ins(ids.done, "audit.event.record", "2026-10-28T19:00:02Z");
    await ins(ids.other, "revenue.refund.processed", "2026-10-28T19:00:03Z");
    await ins(ids.outside, "audit.event.record", "2026-10-30T00:00:00Z");
    await audit`INSERT INTO _inbox.processed (message_id) VALUES (${ids.done})`;
  });
  afterAll(async () => {
    await producer`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
    await audit`DELETE FROM _inbox.processed WHERE message_id = ${ids.done}`;
    await Promise.all([producer.end(), audit.end(), noOutbox.end()]);
  });

  const args = (apply: boolean) => parseArgs(["--from", "2026-10-28T16:00:00Z", "--to", "2026-10-29T15:05:00Z", "--databases", "civitas_revenue", ...(apply ? ["--apply"] : [])]);

  it("skips a database that has no _outbox schema", async () => {
    const r = await replayOne("civitas_test", noOutbox, audit, args(false));
    expect(r).toMatchObject({ status: "skipped", lost: 0 });
  });

  it("dry run: counts by message id, including sibling events with identical content", async () => {
    const r = await replayOne("civitas_revenue", producer, audit, args(false));
    expect(r.status).toBe("ok");
    expect(r.lost).toBe(2);
    expect(r.applied).toBe(0);
    const [{ n }] = await producer<{ n: number }[]>`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND published_at IS NULL`;
    expect(n).toBe(0);
  });

  it("--apply re-queues exactly the lost rows and stamps _replay", async () => {
    const r = await replayOne("civitas_revenue", producer, audit, args(true));
    expect(r).toMatchObject({ status: "ok", lost: 2, applied: 2 });
    const rows = await producer<{ id: string; replay: unknown }[]>`
      SELECT id, payload->'_replay' AS replay FROM _outbox.messages WHERE tenant_id = ${TENANT} AND published_at IS NULL ORDER BY id`;
    expect(rows.map((x) => x.id).sort()).toEqual([ids.lost1, ids.lost2].sort());
    expect(rows.every((x) => x.replay !== null)).toBe(true);
  });

  it("before the dedupe history starts, a miss that audit may hold is ambiguous and never re-queued", async () => {
    const id = randomUUID();
    const corr2 = randomUUID();
    await producer`INSERT INTO _outbox.messages (id, topic, event_type, tenant_id, actor_id, correlation_id, payload, created_at, published_at)
      VALUES (${id}, 'audit.event.record', 'audit.event.record', ${TENANT}, ${TENANT}, ${corr2}, ${producer.json({ action: "x" })},
              '2026-10-28T16:30:00Z', '2026-10-28T16:30:00Z')`;
    await audit`INSERT INTO events.events (tenant_id, type, correlation_id, created_by, created_at, occurred_at)
      VALUES (${TENANT}, 'audit.event.record', ${corr2}, ${TENANT}, '2026-10-28T16:31:00Z', '2026-10-28T16:31:00Z')`;
    try {
      const r = await replayOne("civitas_revenue", producer, audit, args(false), new Date("2026-10-28T18:07:00Z"));
      expect(r.ambiguous).toBe(1);
      expect(r.lost).toBe(0); // lost1/lost2 were re-queued by the previous test
    } finally {
      await producer`DELETE FROM _outbox.messages WHERE id = ${id}`;
    }
  });

  it("rejects bad arguments", () => {
    expect(() => parseArgs(["--from", "x", "--to", "y", "--databases", "all"])).toThrow();
    expect(() => parseArgs(["--from", "2026-10-28T00:00:00Z", "--to", "2026-10-29T00:00:00Z", "--databases", "postgres"])).toThrow();
    expect(parseArgs(["--from", "2026-10-28T00:00:00Z", "--to", "2026-10-29T00:00:00Z", "--databases", "all"]).databases).toBe("all");
  });
});
