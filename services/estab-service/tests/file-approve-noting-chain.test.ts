/**
 * R9 + R10 — eOffice backbone file approval binds to the e-signed green note
 * AND uses the tamper-evident hash chain.
 *
 *  R10: the fileApprove path green-signs the latest submitted note via the SAME
 *       signNotingChain used by the manual/level paths, so the note gets
 *       prev_hash / chain_seq (it no longer sits outside the chain).
 *  R9:  the module decision callback + module_decision_log carry the signed
 *       note's id and dsc_hash (previously null because the code re-queried
 *       findLatestSubmittedNoting AFTER flipping the note out of 'submitted').
 *
 * Runs the real files consumer against the dev DB via MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq, sql } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabNotings } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";

const TENANT  = "11111111-aaaa-4000-8000-0000000000c9";
const OFFICER = "00000000-aaaa-4000-8000-0000000000c9";
const APPROVER = "00000000-aaaa-4000-8000-0000000000ca";
const FILE = "22222222-bbbb-4000-8000-0000000000c9";
const NOTE = "33333333-cccc-4000-8000-0000000000c9";
const SANCTION_REF = "44444444-dddd-4000-8000-0000000000c9";
const APPROVE_MSG = "55555555-eeee-4000-8000-0000000000c9";
const CALLBACK_TOPIC = "finance.sanction.file_decided";

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
      // The immutability trigger blocks deleting a frozen (submitted/approved/rejected)
      // noting. Downgrading note_status to 'draft' (body unchanged → allowed by the
      // trigger) makes the row deletable again for a clean test rerun.
      await tx.execute(sql`UPDATE files.estab_notings SET note_status = 'draft' WHERE tenant_id = ${TENANT}`);
      await tx.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
      await tx.execute(sql`DELETE FROM files.module_decision_log WHERE tenant_id = ${TENANT}`);
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
      await tx.delete(processed).where(eq(processed.messageId, APPROVE_MSG));
    }),
  );
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(async () => {
  await clean();
  // A module-linked eFile (raised by finance_sanction) with one submitted note.
  // Test-harness fix: bare db.insert()/db.execute() outside db.transaction() runs
  // with no RLS GUC set. Wrap seed in runWithTenant + db.transaction().
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(estabFiles).values({
        id: FILE, tenantId: TENANT, fileNo: "EST/2026/C9", subject: "Sanction approval",
        dept: "FIN", priority: "normal", classification: "confidential",
        currentWith: OFFICER, status: "active", createdBy: OFFICER, updatedBy: OFFICER,
      });
      await tx.execute(sql`
        UPDATE files.estab_files
        SET source_ref_type = 'finance_sanction', source_ref_id = ${SANCTION_REF},
            initiated_by = ${OFFICER}, approval_chain = 'finance_sanction_chain'
        WHERE id = ${FILE} AND tenant_id = ${TENANT}
      `);
      await tx.insert(estabNotings).values({
        id: NOTE, tenantId: TENANT, fileId: FILE, seq: 1, officerId: OFFICER,
        body: "Recommended for sanction of ₹5,00,000", action: "initiate",
        noteType: "yellow", noteStatus: "submitted", eSigned: false,
        createdBy: OFFICER, updatedBy: OFFICER,
      });
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("file approval — noting hash chain + decision binding (R9/R10)", () => {
  it("green-signs through the chain and binds the callback to the signed note", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();

    await q.publish("estab.file.approve", {
      messageId: APPROVE_MSG, type: "estab.file.approve",
      tenantId: TENANT, actorId: APPROVER, correlationId: "corr-c9", schemaVersion: "1.0",
      payload: { fileId: FILE, tenantId: TENANT, approvedBy: APPROVER },
    });
    await waitFor(async () =>
      (await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, APPROVE_MSG))),
      )).length === 1);
    await q.stop();

    // R10: the note is greened/e-signed AND part of the hash chain.
    const note = (await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabNotings).where(eq(estabNotings.id, NOTE))),
    ))[0];
    expect(note?.noteType).toBe("green");
    expect(note?.noteStatus).toBe("approved");
    expect(note?.eSigned).toBe(true);
    expect(note?.dscHash).toBeTruthy();

    const chainRows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.execute(sql`
        SELECT chain_seq, prev_hash, dsc_hash FROM files.estab_notings WHERE id = ${NOTE}
      `)),
    );
    const chain = (chainRows as unknown as Array<{ chain_seq: number | null; prev_hash: string | null; dsc_hash: string | null }>)[0];
    expect(chain?.chain_seq).toBe(1); // first link in the chain (R10)

    // R9: the module_decision_log binds the decision to the signed note's id + hash.
    const logRows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.execute(sql`
        SELECT noting_id, dsc_hash, decision FROM files.module_decision_log
        WHERE file_id = ${FILE} AND tenant_id = ${TENANT}
      `)),
    );
    const log = (logRows as unknown as Array<{ noting_id: string | null; dsc_hash: string | null; decision: string }>)[0];
    expect(log?.decision).toBe("approved");
    expect(log?.noting_id).toBe(NOTE);
    expect(log?.dsc_hash).toBe(note?.dscHash); // bound to the e-signed green note (R9)

    // The decision callback emitted to the source module carries the same binding.
    const outbox = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))),
    );
    const callback = outbox.find((m) => m.eventType === CALLBACK_TOPIC);
    expect(callback).toBeTruthy();
    const payload = callback!.payload as { notingId?: string; dscHash?: string; decision?: string };
    expect(payload.notingId).toBe(NOTE);
    expect(payload.dscHash).toBe(note?.dscHash);
  });
});
