import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfa } from "../src/modules/dfa/schema.js";
import { processed } from "../src/shared/outbox.js";
import * as repo from "../src/modules/dfa/repo.js";
import { canTransition } from "../src/modules/dfa/domain.js";
import { registerDfaConsumers } from "../src/modules/dfa/consumer.js";
import { COMMANDS } from "../src/topics.js";

function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const TENANT = "22222222-aaaa-4000-8000-0000000000f5";
const ACTOR  = "00000000-aaaa-4000-8000-0000000000f5";

const env = (type: string, payload: Record<string, unknown>, actor = ACTOR) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: actor, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};
async function waitProcessed(messageId: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId))),
    );
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe("debug dfa", () => {
  it("create then submit", async () => {
    const did = randomUUID();
    const mk = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 })); registerDfaConsumers(mk); await mk.start();
    const mCreate = env(COMMANDS.dfaCreate, { id: did, tenantId: TENANT, dfaNo: "DFA/2026/1", communicationType: "letter", subject: "S", body: "B" }, ACTOR);
    await mk.publish(COMMANDS.dfaCreate, mCreate); await waitProcessed(mCreate.messageId);

    const cur = await runWithTenant(TENANT, () => repo.findDfaById(did, TENANT));
    console.log("cur via repo.findDfaById:", cur?.status, cur?.id);
    console.log("canTransition(draft, pending_approval):", canTransition("draft", "pending_approval" as any));

    const mSubmit = env(COMMANDS.dfaSubmit, { id: did, tenantId: TENANT }, ACTOR);
    await mk.publish(COMMANDS.dfaSubmit, mSubmit);
    const procRow = await waitProcessed(mSubmit.messageId).then(() => "processed").catch((e) => "err:" + e);
    console.log("submit processed marker:", procRow);
    console.log("dlq:", JSON.stringify(mk.dlq));

    const afterSubmit = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(estabDfa).where(eq(estabDfa.id, did)))))[0];
    console.log("AFTER SUBMIT:", afterSubmit?.status);
    await mk.stop();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(estabDfa).where(eq(estabDfa.id, did))));
    await sqlClient.end();
  });
});
