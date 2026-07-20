/**
 * R2 (gap analysis) — CSMOP file-type taxonomy. Verified through the real files
 * consumer against the dev DB: opening volumes and part files derives the right
 * child numbers and parentage, files link symmetrically, and a file can be
 * reclassified (e.g. standing guard).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabNotings } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { deriveChildFileNo, toRoman } from "../src/modules/files/domain.js";

const TENANT = "11111111-aaaa-4000-8000-0000000000f2";
const OFFICER = "00000000-bbbb-4000-8000-0000000000f2";

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

// Test-harness fix: bare db.delete()/db.execute() outside db.transaction() runs
// with no RLS GUC set. Wrap cleanup in runWithTenant + db.transaction().
async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.execute(sql`UPDATE files.estab_notings SET note_status='draft' WHERE tenant_id=${TENANT}`);
      await tx.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
      await tx.execute(sql`UPDATE files.estab_files SET parent_file_id=NULL, linked_file_ids='{}'::uuid[] WHERE tenant_id=${TENANT}`);
      await tx.execute(sql`DELETE FROM files.estab_doc_seq WHERE tenant_id=${TENANT}`);
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
    }),
  );
}

const env = (type: string, payload: Record<string, unknown>) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: OFFICER, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
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
async function fileById(id: string) {
  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.select().from(estabFiles).where(eq(estabFiles.id, id))),
  );
  return rows[0];
}
async function createMain(q: Queue, id: string, section: string, subject: string) {
  const m = env(COMMANDS.fileCreate, { id, tenantId: TENANT, section, subject, dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
  await q.publish(COMMANDS.fileCreate, m); await waitProcessed(m.messageId);
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("file-type taxonomy domain (R2)", () => {
  it("derives volume and part numbers", () => {
    expect(toRoman(2)).toBe("II");
    expect(toRoman(4)).toBe("IV");
    expect(deriveChildFileNo("ESTAB-A/00001/2026", "volume", 2)).toBe("ESTAB-A/00001/2026/Vol-II");
    expect(deriveChildFileNo("ESTAB-A/00001/2026", "part", 1)).toBe("ESTAB-A/00001/2026(Part-1)");
  });
});

describe("file-type taxonomy (R2)", () => {
  it("opens Vol II and Vol III off a main file, with correct numbering and parentage", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue()); registerFilesConsumers(q); await q.start();
    const main = randomUUID();
    await createMain(q, main, "VOL-A", "Pay revision");
    const baseNo = (await fileById(main))?.fileNo as string;

    const v2 = randomUUID();
    const mv2 = env(COMMANDS.fileOpenVolume, { id: v2, baseFileId: main, tenantId: TENANT, currentWith: OFFICER });
    await q.publish(COMMANDS.fileOpenVolume, mv2); await waitProcessed(mv2.messageId);
    const v3 = randomUUID();
    const mv3 = env(COMMANDS.fileOpenVolume, { id: v3, baseFileId: v2, tenantId: TENANT, currentWith: OFFICER });
    await q.publish(COMMANDS.fileOpenVolume, mv3); await waitProcessed(mv3.messageId);
    await q.stop();

    const rv2 = await fileById(v2), rv3 = await fileById(v3);
    expect(rv2?.fileType).toBe("volume");
    expect(rv2?.volumeNo).toBe(2);
    expect(rv2?.fileNo).toBe(`${baseNo}/Vol-II`);
    expect(rv2?.parentFileId).toBe(main);
    // a third volume opened off Vol II still parents to the main file and is Vol III
    expect(rv3?.volumeNo).toBe(3);
    expect(rv3?.fileNo).toBe(`${baseNo}/Vol-III`);
    expect(rv3?.parentFileId).toBe(main);
  });

  it("opens part files with incrementing part numbers", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue()); registerFilesConsumers(q); await q.start();
    const main = randomUUID();
    await createMain(q, main, "PART-A", "Court case");
    const baseNo = (await fileById(main))?.fileNo as string;

    const p1 = randomUUID(), p2 = randomUUID();
    const mp1 = env(COMMANDS.fileOpenPart, { id: p1, baseFileId: main, tenantId: TENANT, subject: null, currentWith: OFFICER });
    await q.publish(COMMANDS.fileOpenPart, mp1); await waitProcessed(mp1.messageId);
    const mp2 = env(COMMANDS.fileOpenPart, { id: p2, baseFileId: main, tenantId: TENANT, subject: null, currentWith: OFFICER });
    await q.publish(COMMANDS.fileOpenPart, mp2); await waitProcessed(mp2.messageId);
    await q.stop();

    expect((await fileById(p1))?.fileNo).toBe(`${baseNo}(Part-1)`);
    expect((await fileById(p2))?.fileNo).toBe(`${baseNo}(Part-2)`);
    expect((await fileById(p2))?.partNo).toBe(2);
  });

  it("links two files symmetrically and reclassifies a file as standing guard", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue()); registerFilesConsumers(q); await q.start();
    const a = randomUUID(), b = randomUUID();
    await createMain(q, a, "LINK-A", "Policy A");
    await createMain(q, b, "LINK-B", "Policy B");

    const ml = env(COMMANDS.fileLink, { fileId: a, targetFileId: b, tenantId: TENANT });
    await q.publish(COMMANDS.fileLink, ml); await waitProcessed(ml.messageId);

    const mt = env(COMMANDS.fileSetType, { fileId: a, fileType: "standing_guard", tenantId: TENANT });
    await q.publish(COMMANDS.fileSetType, mt); await waitProcessed(mt.messageId);
    await q.stop();

    expect((await fileById(a))?.linkedFileIds).toContain(b);
    expect((await fileById(b))?.linkedFileIds).toContain(a);
    expect((await fileById(a))?.fileType).toBe("standing_guard");
  });
});
