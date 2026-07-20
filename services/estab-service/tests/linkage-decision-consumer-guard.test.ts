/**
 * R21 — the eOffice raise path fails closed for a source type whose decision
 * callback no module consumes: no eFile is created (so an approval can't be
 * silently lost), and the rejection is audited. Supported types still raise.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerLinkageConsumers } from "../src/modules/linkage/consumer.js";
import { COMMANDS } from "../src/topics.js";

/**
 * Test-harness fix: `new MemoryQueue()` used directly here (not the
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Production wiring (queue-service's `createQueue()`)
 * decorates `subscribe()` so every consumer handler runs inside
 * `runWithTenant(msg.tenantId, ...)`, which is what lets `db.transaction()`
 * pick up the tenant GUC. Mirror that decoration here.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const TENANT = "11111111-aaaa-4000-8000-0000000000e2";
const ACTOR = "00000000-aaaa-4000-8000-0000000000e2";

// Test-harness fix: bare db.delete() outside db.transaction() runs with no
// RLS GUC set — wrap in runWithTenant + db.transaction().
async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
    }),
  );
}

function raise(fileId: string, sourceRefType: string) {
  const messageId = randomUUID();
  return {
    envelope: {
      messageId, type: COMMANDS.fileFromModule, tenantId: TENANT, actorId: ACTOR,
      correlationId: `corr-${fileId.slice(0, 6)}`, schemaVersion: "1.0",
      payload: {
        id: fileId, tenantId: TENANT, fileNo: `EST/${fileId.slice(0, 6)}`,
        subject: "Raise test", dept: "FIN", classification: "confidential", priority: "normal",
        currentWith: ACTOR, sourceRefType, sourceRefId: randomUUID(), initiatedBy: ACTOR,
        approvalChain: "finance_sanction_chain", initialNote: "Proposed", sourceContext: { amountMinor: 1000 },
      },
    },
    messageId,
  };
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("eOffice raise — decision-consumer guard (R21)", () => {
  it("rejects an unsupported source type — no file created, rejection audited", async () => {
    const fileId = randomUUID();
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerLinkageConsumers(q);
    await q.start();
    // Use a type string NOT in SOURCE_REF_TYPES at all (simulates a typo / future type)
    const m = raise(fileId, "unknown_unsupported_type" as never);
    await q.publish(COMMANDS.fileFromModule, m.envelope);
    await waitFor(async () =>
      (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, m.messageId))))).length === 1,
    );
    await q.stop();

    const files = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(estabFiles).where(eq(estabFiles.id, fileId))));
    expect(files).toHaveLength(0); // fail-closed: no orphaned file

    const audits = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(audits.some((a) => (a.payload as { action?: string }).action === "raise_rejected_no_decision_consumer")).toBe(true);
  });

  it("accepts a supported source type — file is created", async () => {
    const fileId = randomUUID();
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerLinkageConsumers(q);
    await q.start();
    const m = raise(fileId, "finance_sanction"); // has a decision consumer
    await q.publish(COMMANDS.fileFromModule, m.envelope);
    await waitFor(async () =>
      (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, m.messageId))))).length === 1,
    );
    await q.stop();

    const files = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(estabFiles).where(eq(estabFiles.id, fileId))));
    expect(files).toHaveLength(1);
  });
});
