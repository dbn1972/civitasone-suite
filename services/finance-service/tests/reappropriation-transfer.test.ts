/**
 * R4 — re-appropriation zero-sum transfer (GFR Rule 10), end-to-end through the
 * budget consumer against the dev DB.
 *
 * Proves the equal-and-opposite legs: the source budget's re_minor is debited
 * and the target budget's re_minor is credited by the same amount, so total
 * appropriation is conserved. Also proves an over-spent source is rejected
 * (the consumer throws → transaction rolls back → no balances move).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { financeBudgets } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a4";
const ACTOR  = "00000000-aaaa-4000-8000-0000000000a4";

const SRC_ID = "44444444-aaaa-4000-8000-000000000001";
const TGT_ID = "44444444-aaaa-4000-8000-000000000002";
const HEAD_A = "44444444-bbbb-4000-8000-000000000001";
const HEAD_B = "44444444-bbbb-4000-8000-000000000002";

const OK_MSG   = "44444444-cccc-4000-8000-000000000001";
const OK_CORR  = "corr-reapprop-ok-1";
const BAD_MSG  = "44444444-cccc-4000-8000-000000000002";
const BAD_CORR = "corr-reapprop-bad-1";

async function seed(srcRe: bigint, srcUtil: bigint, tgtRe: bigint, tgtUtil: bigint) {
  await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, OK_CORR));
  await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, BAD_CORR));
  await db.delete(processed).where(eq(processed.messageId, OK_MSG));
  await db.delete(processed).where(eq(processed.messageId, BAD_MSG));
  await db.delete(financeBudgets).where(eq(financeBudgets.id, SRC_ID));
  await db.delete(financeBudgets).where(eq(financeBudgets.id, TGT_ID));
  await db.insert(financeBudgets).values([
    { id: SRC_ID, tenantId: TENANT, headId: HEAD_A, fy: "2025-26", beMinor: srcRe, reMinor: srcRe, allocatedMinor: 0n, utilisedMinor: srcUtil, currency: "INR", createdBy: ACTOR, updatedBy: ACTOR },
    { id: TGT_ID, tenantId: TENANT, headId: HEAD_B, fy: "2025-26", beMinor: tgtRe, reMinor: tgtRe, allocatedMinor: 0n, utilisedMinor: tgtUtil, currency: "INR", createdBy: ACTOR, updatedBy: ACTOR },
  ]);
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

afterAll(async () => {
  await db.delete(financeBudgets).where(eq(financeBudgets.id, SRC_ID));
  await db.delete(financeBudgets).where(eq(financeBudgets.id, TGT_ID));
  await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, OK_CORR));
  await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, BAD_CORR));
  await db.delete(processed).where(eq(processed.messageId, OK_MSG));
  await db.delete(processed).where(eq(processed.messageId, BAD_MSG));
  await sqlClient.end();
});

describe("re-appropriation consumer — zero-sum transfer (R4)", () => {
  beforeEach(async () => { await seed(100_000n, 20_000n, 30_000n, 0n); });

  it("debits source and credits target by the same amount (total conserved)", async () => {
    const q = new MemoryQueue();
    registerBudgetConsumers(q);
    await q.start();

    await q.publish(COMMANDS.budgetReappropriate, {
      messageId: OK_MSG, type: COMMANDS.budgetReappropriate,
      tenantId: TENANT, actorId: ACTOR, correlationId: OK_CORR, schemaVersion: "1.0",
      payload: { id: TGT_ID, tenantId: TENANT, fromBudgetId: SRC_ID, amountMinor: 50_000, reason: "Q3 shortfall on Head B" },
    });

    await waitFor(async () =>
      (await db.select().from(processed).where(eq(processed.messageId, OK_MSG))).length === 1);
    await q.stop();

    const src = (await db.select().from(financeBudgets).where(eq(financeBudgets.id, SRC_ID)))[0];
    const tgt = (await db.select().from(financeBudgets).where(eq(financeBudgets.id, TGT_ID)))[0];
    expect(src?.reMinor).toBe(50_000n);   // 100k - 50k
    expect(tgt?.reMinor).toBe(80_000n);   // 30k + 50k
    // total appropriation conserved
    expect((src!.reMinor + tgt!.reMinor)).toBe(130_000n);
    // target RE now exceeds its own BE (30k) — that is the purpose of re-appropriation
    expect(tgt!.reMinor).toBeGreaterThan(tgt!.beMinor);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.correlationId, OK_CORR));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });

  it("rejects a transfer exceeding source savings — no balances move", async () => {
    const q = new MemoryQueue();
    registerBudgetConsumers(q);
    await q.start();

    // source savings = 100k - 20k = 80k; request 90k must fail
    await q.publish(COMMANDS.budgetReappropriate, {
      messageId: BAD_MSG, type: COMMANDS.budgetReappropriate,
      tenantId: TENANT, actorId: ACTOR, correlationId: BAD_CORR, schemaVersion: "1.0",
      payload: { id: TGT_ID, tenantId: TENANT, fromBudgetId: SRC_ID, amountMinor: 90_000, reason: "over-draw attempt" },
    });

    // give the consumer a moment to attempt + roll back
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const src = (await db.select().from(financeBudgets).where(eq(financeBudgets.id, SRC_ID)))[0];
    const tgt = (await db.select().from(financeBudgets).where(eq(financeBudgets.id, TGT_ID)))[0];
    expect(src?.reMinor).toBe(100_000n); // unchanged
    expect(tgt?.reMinor).toBe(30_000n);  // unchanged
  });
});
