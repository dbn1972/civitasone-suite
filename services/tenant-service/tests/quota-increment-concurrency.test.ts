/**
 * CLOS3-S6-04 — quota.increment did an application-side read-modify-write
 * (read used, Math.max(0, used+delta) in JS, write back with no lock or version check), so two
 * concurrent increments both read used=5 and both wrote 6, losing one.
 * The increment is now a single atomic UPDATE (row-locked by Postgres), with newUsed/limit taken
 * from RETURNING.
 *
 * Real Postgres. A barrier on repo.update forces the lost-update interleave for the old code path.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { quotas } from "../src/modules/quotas/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import * as repo from "../src/modules/quotas/repo.js";
import { registerQuotaConsumers } from "../src/modules/quotas/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR = "00000000-bbbb-4000-8000-000000000001";
const tenants: string[] = [];
const newTenant = () => { const t = randomUUID(); tenants.push(t); return t; };

type Handler = (msg: unknown) => Promise<void>;
function handlers(): Map<string, Handler> {
  const map = new Map<string, Handler>();
  const fake = {
    subscribe: (topic: string, h: (m: { tenantId: string }) => Promise<void>) => {
      map.set(topic, (m) => runWithTenant((m as { tenantId: string }).tenantId, () => h(m as { tenantId: string })));
    },
  } as unknown as Queue;
  registerQuotaConsumers(fake);
  return map;
}

const inc = (tenantId: string, delta: number) => ({
  messageId: randomUUID(), type: COMMANDS.quotaIncrement, tenantId, actorId: ACTOR,
  correlationId: randomUUID(), schemaVersion: "1.0",
  payload: { tenantId, resource: "users", delta },
});

async function seed(tenantId: string, used: number, limit = 100) {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await repo.insert(tx as unknown as repo.Writer, {
      id: randomUUID(), tenantId, resource: "users", limit, used,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    });
  }));
}
const row = (tenantId: string) => runWithTenant(tenantId, () => db.transaction(async (tx) =>
  (await tx.select().from(quotas).where(eq(quotas.tenantId, tenantId)))[0]!));

afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of tenants.splice(0)) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(quotas).where(eq(quotas.tenantId, t));
    }));
  }
});
afterAll(async () => { await sqlClient.end(); });

describe("quota.increment — atomic under concurrency (CLOS3-S6-04)", () => {
  it("two forced-interleaved increments of +1 on used=5 end at 7, not 6", async () => {
    const t = newTenant();
    await seed(t, 5);
    const h = handlers().get(COMMANDS.quotaIncrement)!;

    // Barrier: neither writer may write until both have read (releases after 750ms if one is blocked on a lock).
    const original = repo.update;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(repo, "update").mockImplementation(async (...args) => {
      arrived += 1;
      if (arrived >= 2) release();
      await Promise.race([gate, new Promise<void>((r) => setTimeout(r, 750))]);
      return original(...args);
    });

    await Promise.all([h(inc(t, 1)), h(inc(t, 1))]);
    expect((await row(t)).used).toBe(7);
  }, 20_000);

  it("20 concurrent increments of +1 are all counted", async () => {
    const t = newTenant();
    await seed(t, 5);
    const h = handlers().get(COMMANDS.quotaIncrement)!;
    await Promise.all(Array.from({ length: 20 }, () => h(inc(t, 1))));
    const r = await row(t);
    expect(r.used).toBe(25);
    expect(r.version).toBeGreaterThanOrEqual(21); // version bumped per increment
  }, 30_000);

  it("clamps at zero for a negative delta and still reports newUsed/overLimit from the committed row", async () => {
    const t = newTenant();
    await seed(t, 2, 10);
    const h = handlers().get(COMMANDS.quotaIncrement)!;
    await h(inc(t, -5));
    expect((await row(t)).used).toBe(0);

    await h(inc(t, 10)); // reaches the limit -> overLimit
    const events = await runWithTenant(t, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, t))));
    const incremented = events.filter((e) => e.topic === EVENTS.quotaIncremented)
      .map((e) => e.payload as { newUsed: number; overLimit: boolean });
    expect(incremented.map((e) => e.newUsed).sort((a, b) => a - b)).toEqual([0, 10]);
    expect(incremented.find((e) => e.newUsed === 10)!.overLimit).toBe(true);
    expect(incremented.find((e) => e.newUsed === 0)!.overLimit).toBe(false);
  }, 20_000);

  it("still rejects when no quota row exists", async () => {
    const t = newTenant();
    const h = handlers().get(COMMANDS.quotaIncrement)!;
    await expect(h(inc(t, 1))).rejects.toThrow(/not found/);
  }, 20_000);
});
