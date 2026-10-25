/**
 * V4-F-01 regression: the message-timeout sweeper and the message-correlate
 * consumer must compare-and-set on status='active'. A subscription that was
 * matched (or expired) between the unlocked SELECT and the UPDATE must NOT be
 * overwritten, and no completeTask command / history / audit rows may be
 * emitted for the losing side of the race.
 *
 * The race window is forced deterministically: a hook runs right after the
 * repo's read returns and flips the row, exactly as a concurrent writer would.
 */
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

const hooks = vi.hoisted(() => ({
  afterFindExpired: null as null | (() => Promise<void>),
  afterFindActive: null as null | (() => Promise<void>),
}));

vi.mock("../src/modules/messages/repo.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/modules/messages/repo.js")>();
  return {
    ...real,
    findExpiredSubscriptions: async (...args: Parameters<typeof real.findExpiredSubscriptions>) => {
      const rows = await real.findExpiredSubscriptions(...args);
      if (hooks.afterFindExpired) await hooks.afterFindExpired();
      return rows;
    },
    findActiveMessageSubscription: async (...args: Parameters<typeof real.findActiveMessageSubscription>) => {
      const row = await real.findActiveMessageSubscription(...args);
      if (hooks.afterFindActive) await hooks.afterFindActive();
      return row;
    },
  };
});

import { db, sqlClient } from "../src/shared/db.js";
import { messageSubscriptions } from "../src/modules/messages/schema.js";
import { sweepExpiredMessages } from "../src/modules/messages/sweeper.js";
import { registerMessagesConsumers } from "../src/modules/messages/consumer.js";
import { TestQueue, asTenant, sqlAsTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string {
  const t = randomUUID();
  tenants.push(t);
  return t;
}

async function seed(tenantId: string, timedOut: boolean) {
  const id = randomUUID();
  const taskId = randomUUID();
  const key = `corr-${id.slice(0, 8)}`;
  await asTenant(tenantId, () =>
    db.transaction(async (tx) =>
      tx.insert(messageSubscriptions).values({
        id,
        tenantId,
        instanceId: randomUUID(),
        taskId,
        messageName: "ExternalApproval",
        correlationKey: key,
        nodeKey: "wait_approval",
        timeoutAt: timedOut ? new Date(Date.now() - 60_000) : null,
        status: "active",
      }),
    ),
  );
  return { id, taskId, key };
}

async function setStatus(tenantId: string, id: string, status: string) {
  await sqlAsTenant(tenantId, sql`UPDATE workflow.message_subscriptions SET status = ${status} WHERE id = ${id}`);
}
async function statusOf(tenantId: string, id: string): Promise<string> {
  const r = await sqlAsTenant(tenantId, sql`SELECT status FROM workflow.message_subscriptions WHERE id = ${id}`);
  return (r[0] as { status: string }).status;
}
async function outboxFor(tenantId: string, taskId: string, topicLike: string): Promise<number> {
  const r = await sqlAsTenant(
    tenantId,
    sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic LIKE ${topicLike} AND payload::text LIKE ${"%" + taskId + "%"}`,
  );
  return (r[0] as { n: number }).n;
}

afterEach(async () => {
  hooks.afterFindExpired = null;
  hooks.afterFindActive = null;
  for (const t of tenants) {
    await sqlAsTenant(t, sql`DELETE FROM workflow.message_subscriptions WHERE tenant_id = ${t}`).catch(() => undefined);
    await sqlAsTenant(t, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`).catch(() => undefined);
    await sqlAsTenant(t, sql`DELETE FROM workflow.transition_history WHERE tenant_id = ${t}`).catch(() => undefined);
  }
  tenants.length = 0;
});
afterAll(async () => {
  await sqlClient.end();
});

describe("V4-F-01 — message subscription expiry is a compare-and-set", () => {
  it("sweeper does not overwrite a subscription matched after its SELECT, nor reject the waiting task", async () => {
    const t = newTenant();
    const s = await seed(t, true);
    hooks.afterFindExpired = async () => setStatus(t, s.id, "matched");

    await sweepExpiredMessages(new Date(), 100);

    expect(await statusOf(t, s.id)).toBe("matched");
    const rejects = await outboxFor(t, s.taskId, "workflow.task.complete");
    expect(rejects).toBe(0);
    const hist = await sqlAsTenant(t, sql`SELECT count(*)::int AS n FROM workflow.transition_history WHERE task_id = ${s.taskId}`);
    expect((hist[0] as { n: number }).n).toBe(0);
  });

  it("sweeper still expires an untouched subscription and rejects its task exactly once", async () => {
    const t = newTenant();
    const s = await seed(t, true);

    await sweepExpiredMessages(new Date(), 100);
    await sweepExpiredMessages(new Date(), 100);

    expect(await statusOf(t, s.id)).toBe("expired");
    expect(await outboxFor(t, s.taskId, "workflow.task.complete")).toBe(1);
  });

  it("correlate consumer does not match a subscription the sweeper expired after its lookup", async () => {
    const t = newTenant();
    const s = await seed(t, false);
    hooks.afterFindActive = async () => setStatus(t, s.id, "expired");

    const q = new TestQueue();
    registerMessagesConsumers(q);
    await q.deliver(
      "workflow.message.correlate",
      { tenantId: t, messageName: "ExternalApproval", correlationKey: s.key, payload: { ok: true } },
      { tenantId: t, actorId: randomUUID(), messageId: randomUUID() },
    );

    expect(await statusOf(t, s.id)).toBe("expired");
    expect(await outboxFor(t, s.taskId, "workflow.task.complete")).toBe(0);
  });
});
