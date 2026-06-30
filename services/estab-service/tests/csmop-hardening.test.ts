/**
 * CSMOP hardening — gapless file numbering, note designation snapshot,
 * disposal-gated closure, recall/reopen movement verbs, gapless dispatch
 * numbering, receipt attach/detach, and DFA maker-checker. Verified end-to-end
 * through the real consumers against the dev DB via MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabNotings, estabDispatch, estabInward } from "../src/modules/files/schema.js";
import { estabDfa } from "../src/modules/dfa/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { registerRecordsConsumers } from "../src/modules/records/consumer.js";
import { registerDfaConsumers } from "../src/modules/dfa/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "11111111-aaaa-4000-8000-0000000000f5";
const ACTOR  = "00000000-aaaa-4000-8000-0000000000f5";
const ACTOR2 = "00000000-aaaa-4000-8000-0000000000f6";
const OFFICER = "00000000-bbbb-4000-8000-0000000000f5";

async function clean() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.execute(
    // downgrade frozen notes so they can be deleted, then clear
    // eslint-disable-next-line
    (await import("drizzle-orm")).sql`UPDATE files.estab_notings SET note_status='draft' WHERE tenant_id=${TENANT}`,
  );
  await db.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
  await db.delete(estabDispatch).where(eq(estabDispatch.tenantId, TENANT));
  await db.delete(estabInward).where(eq(estabInward.tenantId, TENANT));
  await db.delete(estabDfa).where(eq(estabDfa.tenantId, TENANT));
  await db.execute((await import("drizzle-orm")).sql`DELETE FROM files.estab_file_record WHERE tenant_id=${TENANT}`);
  await db.execute((await import("drizzle-orm")).sql`DELETE FROM files.estab_doc_seq WHERE tenant_id=${TENANT}`);
  await db.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
}

const env = (type: string, payload: Record<string, unknown>, actor = ACTOR) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: actor, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};
async function waitProcessed(messageId: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await db.select().from(processed).where(eq(processed.messageId, messageId))).length === 1) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}
async function settle(ms = 400) { await new Promise((r) => setTimeout(r, ms)); }
async function fileById(id: string) {
  return (await db.select().from(estabFiles).where(eq(estabFiles.id, id)))[0];
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("CSMOP hardening", () => {
  it("allocates GAPLESS file numbers per section+year", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); await q.start();
    const f1 = randomUUID(), f2 = randomUUID();
    const m1 = env(COMMANDS.fileCreate, { id: f1, tenantId: TENANT, section: "ESTAB-A", subject: "Pay revision", dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
    const m2 = env(COMMANDS.fileCreate, { id: f2, tenantId: TENANT, section: "ESTAB-A", subject: "Promotion", dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
    await q.publish(COMMANDS.fileCreate, m1); await waitProcessed(m1.messageId);
    await q.publish(COMMANDS.fileCreate, m2); await waitProcessed(m2.messageId);
    await q.stop();
    const yr = new Date().getFullYear();
    expect((await fileById(f1))?.fileNo).toBe(`ESTAB-A/00001/${yr}`);
    expect((await fileById(f2))?.fileNo).toBe(`ESTAB-A/00002/${yr}`);
  });

  it("captures officer designation/section on a note", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); await q.start();
    const fid = randomUUID();
    const mc = env(COMMANDS.fileCreate, { id: fid, tenantId: TENANT, section: "ESTAB-B", subject: "Note test", dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
    await q.publish(COMMANDS.fileCreate, mc); await waitProcessed(mc.messageId);
    const nid = randomUUID();
    const mn = env(COMMANDS.notingAdd, { id: nid, fileId: fid, tenantId: TENANT, body: "Recommended.", officerId: OFFICER, officerName: "R. Rao", officerDesignation: "Under Secretary", officerSection: "Estab-II" });
    await q.publish(COMMANDS.notingAdd, mn); await waitProcessed(mn.messageId);
    await q.stop();
    const note = (await db.select().from(estabNotings).where(eq(estabNotings.id, nid)))[0];
    expect(note?.officerDesignation).toBe("Under Secretary");
    expect(note?.officerSection).toBe("Estab-II");
  });

  it("blocks closure without a record category, then allows it after assignment", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); registerRecordsConsumers(q); await q.start();
    const fid = randomUUID();
    const mc = env(COMMANDS.fileCreate, { id: fid, tenantId: TENANT, section: "ESTAB-C", subject: "Closure test", dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
    await q.publish(COMMANDS.fileCreate, mc); await waitProcessed(mc.messageId);

    // close attempt WITHOUT a record category → rejected, file not closed
    const mClose1 = env(COMMANDS.fileClose, { fileId: fid, tenantId: TENANT });
    await q.publish(COMMANDS.fileClose, mClose1); await waitProcessed(mClose1.messageId);
    expect((await fileById(fid))?.status).not.toBe("closed");
    const rejected = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(rejected.some((r) => (r.payload as { action?: string }).action === "close_rejected_no_record_category")).toBe(true);

    // assign category B, then close → closed
    const mCat = env("estab.record.assign_category", { fileId: fid, tenantId: TENANT, category: "B" });
    await q.publish("estab.record.assign_category", mCat); await waitProcessed(mCat.messageId);
    const mClose2 = env(COMMANDS.fileClose, { fileId: fid, tenantId: TENANT });
    await q.publish(COMMANDS.fileClose, mClose2); await waitProcessed(mClose2.messageId);
    await q.stop();
    expect((await fileById(fid))?.status).toBe("closed");
  });

  it("supports recall and reopen movement verbs", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); registerRecordsConsumers(q); await q.start();
    const fid = randomUUID();
    const mc = env(COMMANDS.fileCreate, { id: fid, tenantId: TENANT, section: "ESTAB-D", subject: "Move test", dept: "ESTAB", priority: "normal", classification: "public", currentWith: ACTOR });
    await q.publish(COMMANDS.fileCreate, mc); await waitProcessed(mc.messageId);
    // recall by ACTOR (file currently with ACTOR after create draft) — set currentWith back to actor
    const mr = env(COMMANDS.fileRecall, { fileId: fid, tenantId: TENANT, remarks: "wrong marking" });
    await q.publish(COMMANDS.fileRecall, mr); await waitProcessed(mr.messageId);
    expect((await fileById(fid))?.currentWith).toBe(ACTOR);
    // assign category + close, then reopen
    const mCat = env("estab.record.assign_category", { fileId: fid, tenantId: TENANT, category: "C" });
    await q.publish("estab.record.assign_category", mCat); await waitProcessed(mCat.messageId);
    const mClose = env(COMMANDS.fileClose, { fileId: fid, tenantId: TENANT });
    await q.publish(COMMANDS.fileClose, mClose); await waitProcessed(mClose.messageId);
    expect((await fileById(fid))?.status).toBe("closed");
    const mReopen = env(COMMANDS.fileReopen, { fileId: fid, tenantId: TENANT, reason: "fresh reference received" });
    await q.publish(COMMANDS.fileReopen, mReopen); await waitProcessed(mReopen.messageId);
    await q.stop();
    expect((await fileById(fid))?.status).toBe("active");
  });

  it("generates a gapless dispatch number when none supplied", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); await q.start();
    const did = randomUUID();
    const md = env(COMMANDS.dispatchCreate, { id: did, tenantId: TENANT, toAddress: "Ministry of Finance", mode: "post", subject: "OM forwarding" });
    await q.publish(COMMANDS.dispatchCreate, md); await waitProcessed(md.messageId);
    await q.stop();
    const d = (await db.select().from(estabDispatch).where(eq(estabDispatch.id, did)))[0];
    const yr = new Date().getFullYear();
    expect(d?.dispatchNo).toBe(`DSP/${yr}/000001`);
    expect(d?.deliveryStatus).toBe("sent");
  });

  it("attaches a diarised receipt to a file and detaches it with a reason", async () => {
    const q = new MemoryQueue(); registerFilesConsumers(q); await q.start();
    const fid = randomUUID(), iid = randomUUID();
    const mc = env(COMMANDS.fileCreate, { id: fid, tenantId: TENANT, section: "ESTAB-E", subject: "Receipt test", dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
    await q.publish(COMMANDS.fileCreate, mc); await waitProcessed(mc.messageId);
    const mi = env(COMMANDS.inwardRegister, { id: iid, tenantId: TENANT, dakNo: "DAK/2026/9", fromAddress: "Dept X", subject: "Reference", mode: "post", urgency: "urgent" });
    await q.publish(COMMANDS.inwardRegister, mi); await waitProcessed(mi.messageId);
    const ma = env(COMMANDS.inwardAttach, { tenantId: TENANT, inwardId: iid, fileId: fid });
    await q.publish(COMMANDS.inwardAttach, ma); await waitProcessed(ma.messageId);
    expect((await db.select().from(estabInward).where(eq(estabInward.id, iid)))[0]?.fileId).toBe(fid);
    const mdet = env(COMMANDS.inwardDetach, { tenantId: TENANT, inwardId: iid, reason: "wrong file" });
    await q.publish(COMMANDS.inwardDetach, mdet); await waitProcessed(mdet.messageId);
    await q.stop();
    const inw = (await db.select().from(estabInward).where(eq(estabInward.id, iid)))[0];
    expect(inw?.fileId).toBeNull();
    expect(inw?.detachedReason).toBe("wrong file");
  });

  it("DFA maker-checker: drafter cannot approve own DFA; a different officer can", async () => {
    const did = randomUUID();
    const mk = new MemoryQueue({ maxAttempts: 1 }); registerDfaConsumers(mk); await mk.start();
    const mCreate = env(COMMANDS.dfaCreate, { id: did, tenantId: TENANT, dfaNo: "DFA/2026/1", communicationType: "letter", subject: "S", body: "B" }, ACTOR);
    await mk.publish(COMMANDS.dfaCreate, mCreate); await waitProcessed(mCreate.messageId);
    const mSubmit = env(COMMANDS.dfaSubmit, { id: did, tenantId: TENANT }, ACTOR);
    await mk.publish(COMMANDS.dfaSubmit, mSubmit); await waitProcessed(mSubmit.messageId);
    // self-approval (same actor as drafter) → rejected to DLQ
    const mSelf = env(COMMANDS.dfaApprove, { id: did, tenantId: TENANT }, ACTOR);
    await mk.publish(COMMANDS.dfaApprove, mSelf);
    await waitFor(async () => mk.dlq.length === 1);
    expect((await db.select().from(estabDfa).where(eq(estabDfa.id, did)))[0]?.status).toBe("pending_approval");
    expect(mk.dlq[0]?.error).toMatch(/MAKER_CHECKER/);
    // different officer approves → approved
    const mOk = env(COMMANDS.dfaApprove, { id: did, tenantId: TENANT }, ACTOR2);
    await mk.publish(COMMANDS.dfaApprove, mOk); await waitProcessed(mOk.messageId);
    await mk.stop();
    expect((await db.select().from(estabDfa).where(eq(estabDfa.id, did)))[0]?.status).toBe("approved");
  });
});

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((r) => setTimeout(r, 40)); }
}
