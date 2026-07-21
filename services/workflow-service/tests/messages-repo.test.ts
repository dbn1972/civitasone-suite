/**
 * Coverage tests for messages/repo.ts (32% → target: 80%+).
 * Tests message/signal subscription CRUD operations.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { messageSubscriptions, signalSubscriptions } from "../src/modules/messages/schema.js";
import * as repo from "../src/modules/messages/repo.js";

const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const cleanupMsgs: string[] = [];
const cleanupSigs: string[] = [];

afterEach(async () => {
  for (const id of cleanupMsgs) {
    await db.delete(messageSubscriptions).where(eq(messageSubscriptions.id, id)).catch(() => undefined);
  }
  for (const id of cleanupSigs) {
    await db.delete(signalSubscriptions).where(eq(signalSubscriptions.id, id)).catch(() => undefined);
  }
  cleanupMsgs.length = 0;
  cleanupSigs.length = 0;
});

afterAll(async () => { await sqlClient.end(); });

describe("messages/repo — insertMessageSubscription", () => {
  it("inserts a message subscription", async () => {
    const id = randomUUID();
    cleanupMsgs.push(id);

    await repo.insertMessageSubscription(db, {
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "test.msg",
      correlationKey: "KEY-001",
      nodeKey: "catch_node",
      status: "active",
    });

    const row = await repo.findActiveMessageSubscription(TENANT, "test.msg", "KEY-001");
    expect(row).not.toBeNull();
    expect(row!.id).toBe(id);
  });
});

describe("messages/repo — insertSignalSubscription", () => {
  it("inserts a signal subscription", async () => {
    const id = randomUUID();
    cleanupSigs.push(id);

    await repo.insertSignalSubscription(db, {
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      signalName: "test.signal",
      nodeKey: "catch_sig",
      status: "active",
    });

    const rows = await repo.findActiveSignalSubscriptions(TENANT, "test.signal");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.id === id)).toBeDefined();
  });
});

describe("messages/repo — findActiveMessageSubscription", () => {
  it("returns null when no matching subscription", async () => {
    const result = await repo.findActiveMessageSubscription(TENANT, "no.such.msg", "NO-KEY");
    expect(result).toBeNull();
  });

  it("does not return matched subscriptions", async () => {
    const id = randomUUID();
    cleanupMsgs.push(id);

    await db.insert(messageSubscriptions).values({
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "matched.msg",
      correlationKey: "MATCHED-KEY",
      nodeKey: "node1",
      status: "matched",
      matchedAt: new Date(),
    });

    const result = await repo.findActiveMessageSubscription(TENANT, "matched.msg", "MATCHED-KEY");
    expect(result).toBeNull();
  });
});

describe("messages/repo — findActiveSignalSubscriptions", () => {
  it("returns empty array when no matching subscriptions", async () => {
    const result = await repo.findActiveSignalSubscriptions(TENANT, "ghost.signal");
    expect(result).toEqual([]);
  });

  it("only returns active subscriptions", async () => {
    const activeId = randomUUID();
    const matchedId = randomUUID();
    cleanupSigs.push(activeId, matchedId);

    await db.insert(signalSubscriptions).values([
      { id: activeId, tenantId: TENANT, instanceId: randomUUID(), taskId: randomUUID(), signalName: "multi.sig", nodeKey: "n1", status: "active" },
      { id: matchedId, tenantId: TENANT, instanceId: randomUUID(), taskId: randomUUID(), signalName: "multi.sig", nodeKey: "n1", status: "matched", matchedAt: new Date() },
    ]);

    const result = await repo.findActiveSignalSubscriptions(TENANT, "multi.sig");
    expect(result.find((r) => r.id === activeId)).toBeDefined();
    expect(result.find((r) => r.id === matchedId)).toBeUndefined();
  });
});

describe("messages/repo — markMessageMatched", () => {
  it("marks a subscription as matched with payload", async () => {
    const id = randomUUID();
    cleanupMsgs.push(id);

    await db.insert(messageSubscriptions).values({
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "mark.test",
      correlationKey: "MARK-001",
      nodeKey: "node1",
      status: "active",
    });

    await repo.markMessageMatched(db, id, { result: "approved" });

    const rows = await db.select().from(messageSubscriptions).where(eq(messageSubscriptions.id, id));
    expect(rows[0]!.status).toBe("matched");
    expect(rows[0]!.matchedAt).not.toBeNull();
    expect((rows[0]!.matchedPayload as Record<string, unknown>)?.result).toBe("approved");
  });
});

describe("messages/repo — markSignalMatched", () => {
  it("marks a signal subscription as matched", async () => {
    const id = randomUUID();
    cleanupSigs.push(id);

    await db.insert(signalSubscriptions).values({
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      signalName: "sig.mark",
      nodeKey: "node1",
      status: "active",
    });

    await repo.markSignalMatched(db, id);

    const rows = await db.select().from(signalSubscriptions).where(eq(signalSubscriptions.id, id));
    expect(rows[0]!.status).toBe("matched");
    expect(rows[0]!.matchedAt).not.toBeNull();
  });
});

describe("messages/repo — expireSubscription", () => {
  it("expires a message subscription", async () => {
    const id = randomUUID();
    cleanupMsgs.push(id);

    await db.insert(messageSubscriptions).values({
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "expire.test",
      correlationKey: "EXP-001",
      nodeKey: "node1",
      status: "active",
    });

    await repo.expireSubscription(db, id);

    const rows = await db.select().from(messageSubscriptions).where(eq(messageSubscriptions.id, id));
    expect(rows[0]!.status).toBe("expired");
  });
});

describe("messages/repo — findExpiredSubscriptions", () => {
  it("finds subscriptions past their timeout", async () => {
    const id = randomUUID();
    cleanupMsgs.push(id);

    const pastTimeout = new Date(Date.now() - 60 * 1000); // 1 min ago
    await db.insert(messageSubscriptions).values({
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "timeout.test",
      correlationKey: "TO-001",
      nodeKey: "node1",
      status: "active",
      timeoutAt: pastTimeout,
    });

    const results = await repo.findExpiredSubscriptions(new Date(), 100);
    expect(results.find((r) => r.id === id)).toBeDefined();
  });

  it("does not find subscriptions before their timeout", async () => {
    const id = randomUUID();
    cleanupMsgs.push(id);

    const futureTimeout = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    await db.insert(messageSubscriptions).values({
      id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "future.timeout",
      correlationKey: "FT-001",
      nodeKey: "node1",
      status: "active",
      timeoutAt: futureTimeout,
    });

    const results = await repo.findExpiredSubscriptions(new Date(), 100);
    expect(results.find((r) => r.id === id)).toBeUndefined();
  });
});

describe("messages/repo — findSubscriptionsByInstance", () => {
  it("returns both message and signal subscriptions for an instance", async () => {
    const instanceId = randomUUID();
    const msgId = randomUUID();
    const sigId = randomUUID();
    cleanupMsgs.push(msgId);
    cleanupSigs.push(sigId);

    await db.insert(messageSubscriptions).values({
      id: msgId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      messageName: "inst.msg",
      correlationKey: "IM-001",
      nodeKey: "node1",
      status: "active",
    });

    await db.insert(signalSubscriptions).values({
      id: sigId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      signalName: "inst.sig",
      nodeKey: "node1",
      status: "active",
    });

    const result = await repo.findSubscriptionsByInstance(instanceId);
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.signals.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty arrays for instance with no subscriptions", async () => {
    const result = await repo.findSubscriptionsByInstance(randomUUID());
    expect(result.messages).toEqual([]);
    expect(result.signals).toEqual([]);
  });
});

describe("messages/repo — cancelSubscriptionsForInstance", () => {
  it("cancels all active subscriptions for an instance", async () => {
    const instanceId = randomUUID();
    const msgId = randomUUID();
    const sigId = randomUUID();
    cleanupMsgs.push(msgId);
    cleanupSigs.push(sigId);

    await db.insert(messageSubscriptions).values({
      id: msgId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      messageName: "cancel.msg",
      correlationKey: "CL-001",
      nodeKey: "node1",
      status: "active",
    });

    await db.insert(signalSubscriptions).values({
      id: sigId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      signalName: "cancel.sig",
      nodeKey: "node1",
      status: "active",
    });

    await repo.cancelSubscriptionsForInstance(db, instanceId);

    const msgs = await db.select().from(messageSubscriptions).where(eq(messageSubscriptions.id, msgId));
    const sigs = await db.select().from(signalSubscriptions).where(eq(signalSubscriptions.id, sigId));
    expect(msgs[0]!.status).toBe("expired");
    expect(sigs[0]!.status).toBe("expired");
  });
});

describe("messages/repo — listSubscriptions", () => {
  it("lists subscriptions with pagination and optional status filter", async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    cleanupMsgs.push(id1, id2);

    await db.insert(messageSubscriptions).values([
      { id: id1, tenantId: TENANT, instanceId: randomUUID(), taskId: randomUUID(), messageName: "list.1", correlationKey: "L1", nodeKey: "n1", status: "active" },
      { id: id2, tenantId: TENANT, instanceId: randomUUID(), taskId: randomUUID(), messageName: "list.2", correlationKey: "L2", nodeKey: "n1", status: "matched", matchedAt: new Date() },
    ]);

    // List all
    const all = await repo.listSubscriptions(TENANT, 100, 0);
    expect(all.length).toBeGreaterThanOrEqual(2);

    // Filter by status
    const active = await repo.listSubscriptions(TENANT, 100, 0, "active");
    expect(active.find((r) => r.id === id1)).toBeDefined();
    expect(active.find((r) => r.id === id2)).toBeUndefined();
  });
});
