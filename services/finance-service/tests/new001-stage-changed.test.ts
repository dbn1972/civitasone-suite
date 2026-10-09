/**
 * NEW-001 (FF-06, D-66) — the stage-change / guarded-update refusal (I4: the
 * database is the guard).
 *
 *   (a) a command naming expectedStage='section' delivered when the bill has
 *       already advanced to 'accounts' is refused (STAGE_CHANGED) and does not
 *       advance the bill — the pre-read in the route was stale; the consumer
 *       (then the guarded UPDATE) is authoritative.
 *   (b) a concurrent pair — two officers approving the SAME stage at the same
 *       instant — advances the bill exactly ONCE: the guarded UPDATE's
 *       version/stage predicate serialises them, the loser touches zero rows
 *       and is refused (NonRetryableError), with no second advance.
 *
 * Runs the real payments consumer against real Postgres on a MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import * as repo from "../src/modules/payments/repo.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1111-4000-8000-00000000f603";
const MAKER  = "00000000-aaaa-4000-8000-00000000f603";
const OFF_A  = "00000000-bbbb-4000-8000-00000000f603";
const OFF_B  = "00000000-cccc-4000-8000-00000000f603";
const VENDOR = "f6030000-aaaa-4000-8000-000000000001";
const HEAD   = "f6030000-bbbb-4000-8000-000000000001";

const STALE_BILL = "f6030000-cccc-4000-8000-000000000001";
const CONC_BILL  = "f6030000-cccc-4000-8000-000000000002";

const STALE_MSG = "f6030000-dddd-4000-8000-000000000001";
const CONC_MSG_A = "f6030000-dddd-4000-8000-00000000000a";
const CONC_MSG_B = "f6030000-dddd-4000-8000-00000000000b";

const BILLS = [STALE_BILL, CONC_BILL];
const MSGS = [STALE_MSG, CONC_MSG_A, CONC_MSG_B];
const CORRS = ["corr-f603-stale", "corr-f603-conc-a", "corr-f603-conc-b"];

async function seedHead() {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "4703-F603", name: "NEW-001 Stage Change Head", level: 2, createdBy: MAKER, updatedBy: MAKER,
  }).onConflictDoNothing());
}

function seedBill(id: string, stage: string) {
  return scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id, tenantId: TENANT, billNo: `BILL-${id.slice(-8)}`, vendorId: VENDOR, headId: HEAD,
    grossMinor: 500000n, netMinor: 500000n, currency: "INR", deductions: [],
    poRef: "po-f603", grnRef: "grn-f603",
    stage, status: "pending", createdBy: MAKER, updatedBy: MAKER, version: 1,
  }));
}

async function readBill(id: string) {
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id)));
  return rows[0];
}

async function clean() {
  for (const c of CORRS) await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, c)));
  for (const m of MSGS) await db.delete(processed).where(eq(processed.messageId, m));
  for (const b of BILLS) await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, b)));
}

beforeEach(async () => { await clean(); await seedHead(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("NEW-001 stale-stage refusal and guarded-update concurrency (I4)", () => {
  it("(a) refuses a command whose expectedStage no longer matches the bill (STAGE_CHANGED)", async () => {
    // The bill is already at 'accounts', but the command names 'section' (the
    // approver's screen was stale). The consumer must refuse, not re-run
    // stage-1 logic.
    await seedBill(STALE_BILL, "accounts");
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.billApprove, {
      messageId: STALE_MSG, type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: OFF_A, correlationId: "corr-f603-stale", schemaVersion: "1.1",
      payload: { id: STALE_BILL, tenantId: TENANT, expectedStage: "section" },
    });
    await q.drain();
    await q.stop();

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toMatch(/STAGE_CHANGED/);
    const bill = await readBill(STALE_BILL);
    expect(bill?.stage).toBe("accounts"); // unchanged
    expect(bill?.version).toBe(1);
  });

  it("(b) two officers approving the same stage advance the bill exactly once (guarded update serialises)", async () => {
    await seedBill(CONC_BILL, "section");
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    // Both target stage 'section' with the same loaded version — one wins the
    // guarded UPDATE, the other touches zero rows and is refused.
    await q.publish(COMMANDS.billApprove, {
      messageId: CONC_MSG_A, type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: OFF_A, correlationId: "corr-f603-conc-a", schemaVersion: "1.1",
      payload: { id: CONC_BILL, tenantId: TENANT, expectedStage: "section" },
    });
    await q.publish(COMMANDS.billApprove, {
      messageId: CONC_MSG_B, type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: OFF_B, correlationId: "corr-f603-conc-b", schemaVersion: "1.1",
      payload: { id: CONC_BILL, tenantId: TENANT, expectedStage: "section" },
    });
    await q.drain();
    await q.stop();

    const bill = await readBill(CONC_BILL);
    expect(bill?.stage).toBe("accounts"); // advanced exactly ONE stage
    expect(bill?.version).toBe(2);        // exactly one version bump
    // Exactly one of the two deliveries was refused by the guarded update.
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toMatch(/STAGE_CHANGED/);
  });

  it("the guarded update itself refuses a wrong-version advance (unit, race-safe predicate)", async () => {
    await seedBill(CONC_BILL, "section");
    // Direct call with a stale version: must touch zero rows.
    const refused = await scoped(TENANT, (tx) => repo.advanceBillStage(tx as any, {
      id: CONC_BILL, tenantId: TENANT, fromStage: "section", toStage: "accounts", toStatus: "pending",
      version: 99, updatedBy: OFF_A,
    }));
    expect(refused).toBe(0);
    const applied = await scoped(TENANT, (tx) => repo.advanceBillStage(tx as any, {
      id: CONC_BILL, tenantId: TENANT, fromStage: "section", toStage: "accounts", toStatus: "pending",
      version: 1, updatedBy: OFF_A,
    }));
    expect(applied).toBe(1);
    const bill = await readBill(CONC_BILL);
    expect(bill?.stage).toBe("accounts");
    expect(bill?.version).toBe(2);
  });
});
