/**
 * R9 (gap analysis) — system gapless diary/DAK numbering (CSMOP Ch.4) +
 * duplicate-subject detection. Verified through the real files consumer.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabInward, estabNotings } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { findSimilarOpenFiles } from "../src/modules/files/repo.js";
import { COMMANDS } from "../src/topics.js";

/**
 * Test-harness fix: `new MemoryQueue()` used directly here (not the
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Production wiring (queue-service's `createQueue()`)
 * decorates `subscribe()` so every consumer handler runs inside
 * `runWithTenant(msg.tenantId, ...)`, which is what lets `db.transaction()`
 * pick up the tenant GUC. Without this wrapping, consumer writes/reads in
 * these tests run with no RLS GUC set. Mirror that decoration here.
 */
function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const TENANT = "11111111-aaaa-4000-8000-0000000000d9";
const OFFICER = "00000000-bbbb-4000-8000-0000000000d9";

// Test-harness fix: bare db.delete()/db.execute() outside db.transaction()
// runs with no RLS GUC set (wrapWithTenantGuc only injects app.tenant_id
// inside transactions). Wrap cleanup in runWithTenant + db.transaction().
async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.execute(sql`UPDATE files.estab_notings SET note_status='draft' WHERE tenant_id=${TENANT}`);
      await tx.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
      await tx.delete(estabInward).where(eq(estabInward.tenantId, TENANT));
      await tx.execute(sql`DELETE FROM files.estab_doc_seq WHERE tenant_id=${TENANT}`);
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
    }),
  );
}

const env = (type: string, payload: Record<string, unknown>) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: OFFICER, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};
// Test-harness fix: bare db.select() outside db.transaction() runs with no
// RLS GUC set — wrap in runWithTenant + db.transaction() (applies to reads too).
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
async function inwardById(id: string) {
  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.select().from(estabInward).where(eq(estabInward.id, id))),
  );
  return rows[0];
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("DAK diary numbering (R9)", () => {
  it("allocates gapless DAK numbers when none supplied", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue()); registerFilesConsumers(q); await q.start();
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
    const q = wireTenantAwareQueue(new MemoryQueue()); registerFilesConsumers(q); await q.start();
    const i = randomUUID();
    const m = env(COMMANDS.inwardRegister, { id: i, tenantId: TENANT, dakNo: "LEGACY/77", fromAddress: "Dept Z", subject: "Imported" });
    await q.publish(COMMANDS.inwardRegister, m); await waitProcessed(m.messageId);
    await q.stop();
    expect((await inwardById(i))?.dakNo).toBe("LEGACY/77");
  });

  it("detects an existing open file with the same subject", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue()); registerFilesConsumers(q); await q.start();
    const f = randomUUID();
    const mc = env(COMMANDS.fileCreate, { id: f, tenantId: TENANT, section: "DUP", subject: "Pay Revision 2026", dept: "ESTAB", priority: "normal", classification: "public", currentWith: OFFICER });
    await q.publish(COMMANDS.fileCreate, mc); await waitProcessed(mc.messageId);
    await q.stop();
    // Test-harness fix: findSimilarOpenFiles uses a bare db.execute() (not
    // wrapped in db.transaction()), so wrapWithTenantGuc never sets the RLS
    // GUC for it even inside an active tenant context. Establish the tenant
    // context per call here anyway to match the harness convention; this
    // call site is otherwise expected to surface as a genuine RLS gap.
    const hits = await runWithTenant(TENANT, () => findSimilarOpenFiles(TENANT, "  pay revision 2026 ", 10));
    expect(hits.length).toBe(1);
    expect(hits[0]?.id).toBe(f);
    const none = await runWithTenant(TENANT, () => findSimilarOpenFiles(TENANT, "Totally different subject", 10));
    expect(none.length).toBe(0);
  });
});
