/**
 * R9 (gap analysis) — system gapless diary/DAK numbering (CSMOP Ch.4) +
 * duplicate-subject detection. Verified through the real files consumer.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabInward, estabNotings } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { findSimilarOpenFiles } from "../src/modules/files/repo.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "11111111-aaaa-4000-8000-0000000000d9";
const OFFICER = "00000000-bbbb-4000-8000-0000000000d9";

async function clean() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.execute(sql`UPDATE files.estab_notings SET note_status='draft' WHERE tenant_id=${TENANT}`);
  await db.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
  await db.delete(estabInward).where(eq(estabInward.tenantId, TENANT));
  await db.execute(sql`DELETE FROM files.estab_doc_seq WHERE tenant_id=${TENANT}`);
  await db.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
}

const env = (type: string, payload: Record<string, unknown>) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: OFFICER, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};
async function waitProcessed(messageId: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await db.select().from(processed).where(eq(processed.messageId, messageId))).length === 1) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}
async function inwardById(id: string) {
  return (await db.select().from(estabInward).where(eq(estabInward.id, id)))[0];
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("DAK diary numbering (R9)", () => {
  it("allocates gapless DAK numbers when none supplied", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); await q.start();
    const i1 = randomUUID(), i2 = randomUUID();
    const m1 = env(COMMANDS.inwardRegister, { id: i1, tenantId: TENANT, fromAddress: "Dept X", subject: "Ref one" });
    const m2 = env(COMMANDS.inwardRegister, { id: i2, tenantId: TENANT, fromAddress: "Dept Y", subject: "Ref two" });
    await q.publish(COMMANDS.inwardRegister, m1); await waitProcessed(m1.messageId);
    await q.publish(COMMANDS.inwardRegister, m2); await waitProcessed(m2.messageId);
    await q.stop();
    const yr = new Date().getFullYear();
    expect((await inwardById(i1))?.dakNo).toBe(`DAK/${yr}/000001`);
    expect((await inwardById(i2))?.dakNo).toBe(`DAK/${yr}/000002`);
  });

  it("honours a caller-supplied DAK number (legacy/import)", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); await q.start();
    const i = randomUUID();
    const m = env(COMMANDS.inwardRegister, { id: i, tenantId: TENANT, dakNo: "LEGACY/77", fromAddress: "Dept Z", subject: "Imported" });
    await q.publish(COMMANDS.inwardRegister, m); await waitProcessed(m.messageId);
    await q.stop();
    expect((await inwardById(i))?.dakNo).toBe("LEGACY/77");
  });

  it("detects an existing open file with the same subject", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); await q.start();
    const f = randomUUID();
    const mc = env(COMMANDS.fileCreate, { id: f, tenantId: TENANT, section: "DUP", subject: "Pay Revision 2026", dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
    await q.publish(COMMANDS.fileCreate, mc); await waitProcessed(mc.messageId);
    await q.stop();
    const hits = await findSimilarOpenFiles(TENANT, "  pay revision 2026 ", 10);
    expect(hits.length).toBe(1);
    expect(hits[0]?.id).toBe(f);
    const none = await findSimilarOpenFiles(TENANT, "Totally different subject", 10);
    expect(none.length).toBe(0);
  });
});
