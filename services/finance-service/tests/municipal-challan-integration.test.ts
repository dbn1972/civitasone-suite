/**
 * Integration test (real Postgres, no mocks) proving the three fixes applied
 * while porting packages/events/src/municipal-cross.ts from the held branch
 * origin/ai/feature-municipal-sec5-services:
 *
 *   1. receiptHeadId is resolved by CODE per tenant inside the challanCreate
 *      consumer (never a fabricated placeholder UUID from the producer).
 *   2. amountMinor crosses the queue boundary as a base-10 string and is
 *      decoded with @civitasone/schemas' parseMinor — proven here with a
 *      value ABOVE Number.MAX_SAFE_INTEGER that would silently corrupt if it
 *      ever round-tripped through a JS number.
 *   3. sourceService/sourceRef are persisted on the challan row (migration
 *      0070_municipal_cross_service_challan.sql), giving a real back-link
 *      from the created challan to the originating municipal application.
 *
 * Runs the REAL registerTreasuryConsumers + registerGlConsumers against a
 * real Postgres connection (this service's own DB, RLS included) — not the
 * mocked-db unit tests in treasury-consumer.test.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import {
  MUNICIPAL_FEE_RECEIPT_HEAD_CODE,
  buildMunicipalFeeChallanPayload,
} from "@civitasone/events";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerTreasuryConsumers } from "../src/modules/treasury/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeChallans } from "../src/modules/treasury/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { deterministicId } from "../src/modules/gl/spine.js";

// Same platform default tenant migration 0070 seeds the 0075 municipal-fee
// receipt head for — so this test exercises the exact head the migration
// creates, not a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "bb000001-ec00-4000-8000-0000000000ff";
const BANK_CODE = "1100";

// Number.MAX_SAFE_INTEGER (9007199254740991) + 2 — silently rounds to
// ...740992 if it is ever coerced through a JS `number` anywhere in the path.
const HIGH_PRECISION_AMOUNT = "9007199254740993";

/**
 * Drain the outbox backlog fully instead of trusting one bounded
 * relayOnce(limit) call. This suite's real-DB tests (this file and its
 * siblings: recon-db, recon-idempotency-db, rls-isolation,
 * masters-opening-balance-consumer, ...) never truncate their own outbox
 * writes, so re-running the full suite repeatedly (as CI does across many
 * pushes, and as this test itself was observed to do) lets unrelated,
 * never-relayed rows pile up ahead of THIS test's own finance.gl.post
 * message in created_at order. A single relayOnce(100) then returns before
 * ever reaching it once the backlog exceeds 100 rows — this test fails
 * intermittently with "GL journal row must have been posted by the second
 * hop" for a reason that has nothing to do with the fix under test (see
 * .claude/skills/16-production-readiness-audit.md Section 4c). Looping to
 * zero removes the dependency on backlog size entirely.
 */
async function relayToCompletion(queue: MemoryQueue, service: string, maxIterations = 500): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const relayed = await relayOnce(db as never, queue, 200, service);
    if (relayed === 0) return;
  }
  throw new Error(`relayToCompletion: outbox did not drain within ${maxIterations} iterations`);
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like production. */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

beforeAll(async () => {
  // Bank head (1100) is not seeded by any migration for this tenant — the
  // consumer resolves it by code exactly like it resolves the municipal fee
  // head, so both are test fixtures here except 0075 which the migration
  // itself already seeded (proving the migration, not re-creating its work).
  await scoped(TENANT, (tx: any) =>
    tx.insert(financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: BANK_CODE, name: "Bank (municipal-challan-integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
});

describe("municipal cross-service challan — real DB, no mocks", () => {
  it("resolves receiptHeadCode, preserves amountMinor precision, and persists the source back-link", async () => {
    // Confirm migration 0070 actually seeded the head this test (and the
    // shared MUNICIPAL_FEE_RECEIPT_HEAD_CODE constant) depend on.
    const [seededHead] = await scoped(TENANT, (tx: any) =>
      tx.select().from(financeHeads).where(and(eq(financeHeads.tenantId, TENANT), eq(financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE))).limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    const q = tenantWrappedQueue();
    registerTreasuryConsumers(q);
    registerGlConsumers(q);
    await q.start();

    const sourceRef = randomUUID();
    const challanId = randomUUID();
    // Exactly what municipal-cross.ts's buildMunicipalFeeChallanPayload +
    // a service's cross-events.ts emitMunicipalFeeChallan would publish.
    const payload = buildMunicipalFeeChallanPayload({
      id: challanId,
      tenantId: TENANT,
      depositor: "Acme Advertising Co",
      amountMinor: HIGH_PRECISION_AMOUNT,
      sourceService: "advertisement",
      sourceRef,
    });
    expect(payload.receiptHeadCode).toBe(MUNICIPAL_FEE_RECEIPT_HEAD_CODE);
    expect(payload.amountMinor).toBe(HIGH_PRECISION_AMOUNT); // still a string, not a Number

    await q.publish(COMMANDS.challanCreate, makeMsg(COMMANDS.challanCreate, payload));
    await q.drain();
    // Second hop: the challanCreate consumer enqueues finance.gl.post via the
    // outbox (same tx) — relay it once, like the real outbox relay would.
    await relayToCompletion(q, "finance-service");
    await q.drain();

    // ── Fix 1: receiptHeadId resolved by tenant, never a fabricated UUID ──
    const [challanRow] = await scoped(TENANT, (tx: any) =>
      tx.select().from(financeChallans).where(eq(financeChallans.id, challanId)).limit(1),
    );
    expect(challanRow, "challan row must exist").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.receiptHeadId).not.toBe("00000000-0000-4000-8001-00000000fee1"); // the old fabricated placeholder

    // ── Fix 2: amountMinor survives exactly, above Number.MAX_SAFE_INTEGER ──
    expect(challanRow.amountMinor).toBe(BigInt(HIGH_PRECISION_AMOUNT));
    expect(challanRow.amountMinor.toString()).toBe(HIGH_PRECISION_AMOUNT);
    // Documents the precision cliff this fix avoids: naively round-tripping
    // through a JS number (the held branch's Number(bigint) / BigInt(number))
    // silently rounds ...993 down to ...992 — a different, wrong value.
    expect(BigInt(Math.round(Number(HIGH_PRECISION_AMOUNT)))).not.toBe(BigInt(HIGH_PRECISION_AMOUNT));
    expect(challanRow.amountMinor).not.toBe(BigInt(Math.round(Number(HIGH_PRECISION_AMOUNT))));

    // ── Fix 3: sourceService/sourceRef back-link persisted ──
    expect(challanRow.sourceService).toBe("advertisement");
    expect(challanRow.sourceRef).toBe(sourceRef);

    // ── Real GL journal row, correct amount, no precision loss ──
    const journalId = deterministicId(`challan:${challanId}`);
    const [journalRow] = await scoped(TENANT, (tx: any) =>
      tx.select().from(financeJournals).where(eq(financeJournals.id, journalId)).limit(1),
    );
    expect(journalRow, "GL journal row must have been posted by the second hop (finance.gl.post)").toBeTruthy();
    expect(journalRow.lines).toHaveLength(2);
    const creditLine = journalRow.lines.find((l: { creditMinor: string }) => l.creditMinor !== "0");
    const debitLine = journalRow.lines.find((l: { debitMinor: string }) => l.debitMinor !== "0");
    expect(creditLine.creditMinor).toBe(HIGH_PRECISION_AMOUNT);
    expect(debitLine.debitMinor).toBe(HIGH_PRECISION_AMOUNT);
    expect(creditLine.accountCode).toBe(seededHead.id); // credited to the resolved municipal-fee head

    await q.stop();
  });
});
