/**
 * R21 — the eOffice raise path fails closed for a source type whose decision
 * callback no module consumes: no eFile is created (so an approval can't be
 * silently lost), and the rejection is audited. Supported types still raise.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerLinkageConsumers } from "../src/modules/linkage/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "11111111-aaaa-4000-8000-0000000000e2";
const ACTOR = "00000000-aaaa-4000-8000-0000000000e2";

async function clean() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
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
    const q = new MemoryQueue();
    registerLinkageConsumers(q);
    await q.start();
    // Use a type string NOT in SOURCE_REF_TYPES at all (simulates a typo / future type)
    const m = raise(fileId, "unknown_unsupported_type" as never);
    await q.publish(COMMANDS.fileFromModule, m.envelope);
    await waitFor(async () => (await db.select().from(processed).where(eq(processed.messageId, m.messageId))).length === 1);
    await q.stop();

    const files = await db.select().from(estabFiles).where(eq(estabFiles.id, fileId));
    expect(files).toHaveLength(0); // fail-closed: no orphaned file

    const audits = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(audits.some((a) => (a.payload as { action?: string }).action === "raise_rejected_no_decision_consumer")).toBe(true);
  });

  it("accepts a supported source type — file is created", async () => {
    const fileId = randomUUID();
    const q = new MemoryQueue();
    registerLinkageConsumers(q);
    await q.start();
    const m = raise(fileId, "finance_sanction"); // has a decision consumer
    await q.publish(COMMANDS.fileFromModule, m.envelope);
    await waitFor(async () => (await db.select().from(processed).where(eq(processed.messageId, m.messageId))).length === 1);
    await q.stop();

    const files = await db.select().from(estabFiles).where(eq(estabFiles.id, fileId));
    expect(files).toHaveLength(1);
  });
});
