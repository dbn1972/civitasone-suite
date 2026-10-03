/**
 * Regression: workflow.signal.broadcast passed "<messageId>:<subscriptionId>" to markProcessed(),
 * but _inbox.processed.message_id is a uuid column, so every broadcast threw
 * "invalid input syntax for type uuid" and no signal subscription was ever matched.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMessagesConsumers } from "../src/modules/messages/consumer.js";
import { signalSubscriptions } from "../src/modules/messages/schema.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, cleanup, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("workflow.signal.broadcast dedupe key", () => {
  it("matches an active subscription (no invalid-uuid failure) and a redelivery of the same message is a no-op", async () => {
    const tenantId = randomUUID();
    tenants.push(tenantId);
    const q = new TestQueue();
    registerMessagesConsumers(q);
    const sigId = randomUUID();
    await asTenant(tenantId, () => db.transaction(async (tx) => tx.insert(signalSubscriptions).values({
      id: sigId, tenantId, instanceId: randomUUID(), taskId: randomUUID(),
      signalName: "inbox.uuid.sig", nodeKey: "start", status: "active",
    })));

    const messageId = randomUUID();
    const deliver = () => q.deliver("workflow.signal.broadcast", { tenantId, signalName: "inbox.uuid.sig", payload: {} },
      { tenantId, actorId: randomUUID(), messageId });
    await deliver();
    const status = async () => (await sqlAsTenant(tenantId, sql`SELECT status FROM workflow.signal_subscriptions WHERE id = ${sigId}`) as unknown as Array<{ status: string }>)[0]!.status;
    expect(await status()).toBe("matched");
    // the completion is enqueued through the transactional outbox (not q.publish), so count outbox rows
    const completes = async () => (await sqlAsTenant(tenantId,
      sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${COMMANDS.completeTask}`,
    ) as unknown as Array<{ n: number }>)[0]!.n;

    expect(await completes()).toBe(1); // exactly one completion published by the first delivery

    await deliver(); // redelivery: must not throw and must not publish a second completion
    expect(await status()).toBe("matched");
    expect(await completes()).toBe(1);
  });
});
