/**
 * UAT B9-waiver (review of #2417): the waiver cap is "component minus SUM(pending + approved)",
 * a read-then-insert. Without a lock, concurrent waiverCreate commands on one demand all read the
 * same SUM under READ COMMITTED and all pass (reviewer: 4 x 100 against a 150 cap -> 400 waived).
 *
 * Deterministic race against a real Postgres: a blocker transaction holds BOTH the per-demand
 * waiver advisory lock and a SHARE lock on revenue.waivers (plain SELECTs proceed, INSERTs wait).
 * Three commands are started and parked behind the blocker, then it commits.
 *  - Without the fix: each command reads SUM = 0, passes the cap, parks on its INSERT; on release
 *    all three insert (300 waived against 150).
 *  - With the fix: each command parks on the advisory lock BEFORE reading the cap; on release they
 *    run one at a time, so exactly one is accepted and the others are rejected (NonRetryable).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { isNonRetryable, type Handler, type Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { demands } from "../src/modules/assessment/schema.js";
import { waivers } from "../src/modules/trade-license/schema.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { waiverLockKey } from "../src/modules/arrears/outstanding.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "b9c0c000-0000-4000-8000-0000000000a1";
const ACTOR = "b9c0c000-0000-4000-8000-00000000a001";
const DEMAND = "b9c0c000-0000-4000-8000-0000000de001"; // penalty 100 + interest 50 -> cap 150 ("both")

const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function clean() {
  await inTenant(async (tx) => {
    await tx.delete(waivers).where(eq(waivers.tenantId, TENANT));
    await tx.delete(demands).where(eq(demands.tenantId, TENANT));
  });
}

const handlers: Record<string, Handler> = {};
const capture = {
  subscribe: (topic: string, h: Handler) => { handlers[topic] = withTenantConsumer(h) as Handler; },
} as unknown as Queue;

type Outcome = { ok: true } | { ok: false; err: unknown };
const createWaiver = (amountMinor: string): Promise<Outcome> =>
  handlers[COMMANDS.waiverCreate]!({
    messageId: randomUUID(), type: COMMANDS.waiverCreate, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { demandId: DEMAND, amountMinor, reason: "b9 concurrency", waiverType: "both" },
  } as never).then((): Outcome => ({ ok: true }), (err: unknown): Outcome => ({ ok: false, err }));

/** Blocker: advisory lock (what the fix waits on) + SHARE on revenue.waivers (what an INSERT waits on). */
async function holdBlocker(): Promise<{ pid: number; release: () => Promise<void> }> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let locked!: (pid: number) => void;
  const ready = new Promise<number>((r) => { locked = r; });
  const done = inTenant(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${waiverLockKey(TENANT, DEMAND)}, 0))`);
    await tx.execute(sql`LOCK TABLE revenue.waivers IN SHARE MODE`);
    const rows = await tx.execute(sql`select pg_backend_pid()::int as pid`);
    locked(Number((rows as unknown as Array<{ pid: number }>)[0]?.pid));
    await gate;
  });
  const pid = await ready;
  return { pid, release: async () => { release(); await done; } };
}

/** Wait until `n` backends are (transitively) blocked behind the blocker `pid`. */
async function waitForLockWaiters(blocker: number, n: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const rows = await inTenant((tx) => tx.execute(sql`
      select pid::int as pid, pg_blocking_pids(pid) as blockers from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`));
    const waiting = rows as unknown as Array<{ pid: number; blockers: number[] }>;
    const behind = new Set<number>([blocker]);
    for (let grew = true; grew;) {
      grew = false;
      for (const w of waiting) {
        if (!behind.has(w.pid) && w.blockers.some((b) => behind.has(Number(b)))) { behind.add(w.pid); grew = true; }
      }
    }
    if (behind.size - 1 >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiters (have ${behind.size - 1})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  await clean();
  registerArrearsConsumers(capture);
  await inTenant((tx) => tx.insert(demands).values({
    id: DEMAND, tenantId: TENANT, assesseeId: randomUUID(), assessmentId: randomUUID(), rateHeadId: randomUUID(),
    financialYear: "2026-27", dueDate: "2026-04-30", principalMinor: 10_000n, penaltyMinor: 100n,
    interestMinor: 50n, netMinor: 10_150n, computeSnapshot: {}, createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("UAT B9-waiver: concurrent waiverCreate on one demand cannot exceed the cap", () => {
  it("3 concurrent waivers of 100 against a 150 cap -> exactly one accepted, the rest rejected NonRetryable", async () => {
    const { pid, release } = await holdBlocker();
    const runs: Promise<Outcome>[] = [];
    for (let i = 1; i <= 3; i++) {
      runs.push(createWaiver("100"));
      await waitForLockWaiters(pid, i);
    }
    await release();
    const outcomes = await Promise.all(runs);

    const rows = await inTenant((tx) => tx.select().from(waivers).where(eq(waivers.demandId, DEMAND)));
    const waived = rows.reduce((s, r) => s + BigInt(r.amountMinor), 0n);
    expect(waived).toBeLessThanOrEqual(150n);
    expect(rows).toHaveLength(1);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    const rejected = outcomes.filter((o): o is { ok: false; err: unknown } => !o.ok);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(isNonRetryable(r.err)).toBe(true);
      expect((r.err as Error).message).toMatch(/^WAIVER_EXCEEDS_CAP: /);
    }
  });
});
