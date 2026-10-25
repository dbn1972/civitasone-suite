/**
 * CLOS3-S6-07 — subscription commands (upgrade/cancel/suspend/renew/self-service cancel+downgrade) read the
 * subscription, ran assertTransition on the status they read, then wrote unconditionally. The commands arrive
 * on separate topics with independent poll loops, so a cancel racing an upgrade both passed from the same
 * status and the last writer won (a CANCELLED subscription could return to ACTIVE).
 * The tx readers (findByIdTx / findByTenantIdTx) now take a row lock (FOR UPDATE), so the second command
 * re-reads the committed status and fails assertTransition.
 *
 * Real Postgres; repo.update is gated to force the interleave.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { subscriptions } from "../src/modules/subscriptions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import * as repo from "../src/modules/subscriptions/repo.js";
import { registerSubscriptionConsumers } from "../src/modules/subscriptions/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "00000000-cccc-4000-8000-0000000000a1";
const tenants: string[] = [];
const newTenant = () => { const t = randomUUID(); tenants.push(t); return t; };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Handler = (msg: unknown) => Promise<void>;
function handlers(): Map<string, Handler> {
  const map = new Map<string, Handler>();
  const fake = {
    subscribe: (topic: string, h: (m: { tenantId: string }) => Promise<void>) => {
      map.set(topic, (m) => runWithTenant((m as { tenantId: string }).tenantId, () => h(m as { tenantId: string })));
    },
  } as unknown as Queue;
  registerSubscriptionConsumers(fake);
  return map;
}

const env = (topic: string, tenantId: string, payload: unknown) => ({
  messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR,
  correlationId: randomUUID(), schemaVersion: "1.0", payload,
});

async function seed(tenantId: string, status: "active" | "past_due") {
  const id = randomUUID();
  const now = new Date();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await repo.insert(tx as unknown as repo.Writer, {
      id, tenantId, planId: randomUUID(), status,
      startDate: now, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 864e5),
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    });
  }));
  return id;
}
const statusOf = (tenantId: string, id: string) => runWithTenant(tenantId, () => db.transaction(async (tx) =>
  (await tx.select().from(subscriptions).where(eq(subscriptions.id, id)))[0]!.status));

afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of tenants.splice(0)) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(subscriptions).where(eq(subscriptions.tenantId, t));
    }));
  }
});
afterAll(async () => { await sqlClient.end(); });

describe("subscription commands — row-locked read-modify-write (CLOS3-S6-07)", () => {
  it("cancel racing an upgrade: the subscription ends CANCELLED and exactly one command is rejected", async () => {
    const t = newTenant();
    const id = await seed(t, "past_due"); // past_due may be cancelled OR upgraded to active
    const h = handlers();

    // The cancel pauses after its read until the upgrade has been started; the upgrade's WRITE is held until the
    // cancel has finished (so, without a lock, the upgrade overwrites the cancel using its stale read).
    const original = repo.update;
    let startUpgrade!: () => void;
    const upgradeStarted = new Promise<void>((r) => { startUpgrade = r; });
    let cancelDone!: () => void;
    const cancelFinished = new Promise<void>((r) => { cancelDone = r; });
    vi.spyOn(repo, "update").mockImplementation(async (tx, uid, patch) => {
      if (patch.status === "cancelled") await upgradeStarted;
      else await Promise.race([cancelFinished, sleep(3000)]);
      return original(tx, uid, patch);
    });

    const cancel = h.get(COMMANDS.subscriptionCancel)!(env(COMMANDS.subscriptionCancel, t, { id, reason: "r", immediate: true }))
      .finally(() => cancelDone());
    await sleep(100); // cancel has read (and, with the fix, holds the row lock)
    const upgrade = h.get(COMMANDS.subscriptionUpgrade)!(env(COMMANDS.subscriptionUpgrade, t, { id, newPlanId: randomUUID(), effectiveDate: null }));
    await sleep(300); // upgrade has read (stale read without the fix; blocked on the lock with it)
    startUpgrade();

    const [c, u] = await Promise.allSettled([cancel, upgrade]);
    expect(c.status).toBe("fulfilled");
    expect(u.status).toBe("rejected");
    expect(String((u as PromiseRejectedResult).reason)).toMatch(/transition cancelled/);
    expect(await statusOf(t, id)).toBe("cancelled");
  }, 30_000);

  it("self-service cancel racing an admin cancel: exactly one succeeds", async () => {
    const t = newTenant();
    const id = await seed(t, "active");
    const h = handlers();

    const original = repo.update;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(repo, "update").mockImplementation(async (...args) => {
      arrived += 1;
      if (arrived >= 2) release();
      await Promise.race([gate, sleep(750)]);
      return original(...args);
    });

    const results = await Promise.allSettled([
      h.get(COMMANDS.subscriptionCancel)!(env(COMMANDS.subscriptionCancel, t, { id, reason: "admin", immediate: false })),
      h.get(COMMANDS.subscriptionCancelSelf)!(env(COMMANDS.subscriptionCancelSelf, t, { reason: "self" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/transition cancelled/);
    expect(await statusOf(t, id)).toBe("cancelled");
  }, 30_000);
});
