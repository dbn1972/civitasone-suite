/**
 * R11 — maker-checker on sanctions.
 *
 *  - sanctionCreate produces a `pending_approval` sanction (NOT self-approved),
 *    and emits NO sanction.approved event
 *  - a checker (different officer) approving it moves it to `approved` and emits
 *    finance.sanction.approved
 *  - the maker approving their own sanction is rejected (SoD violation → DLQ)
 *
 * Runs the real budget consumers against the dev DB via MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { assertSanctionApproverDistinct, DomainError } from "../src/modules/budget/domain.js";
import { financeSanctions } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b1";
const MAKER  = "00000000-aaaa-4000-8000-0000000a0011";
const CHECKER = "00000000-aaaa-4000-8000-0000000c0011";
const HEAD   = "66666666-bbbb-4000-8000-000000000001";

const SANC = "66666666-cccc-4000-8000-000000000001";
const CREATE_MSG = "66666666-dddd-4000-8000-000000000001";
const APPROVE_MSG = "66666666-dddd-4000-8000-000000000002";
const SELF_MSG = "66666666-dddd-4000-8000-000000000003";

async function clean() {
  await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, "corr-mc"));
  for (const m of [CREATE_MSG, APPROVE_MSG, SELF_MSG]) {
    await db.delete(processed).where(eq(processed.messageId, m));
  }
  await db.delete(financeSanctions).where(eq(financeSanctions.id, SANC));
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("sanction SoD (R11) — pure", () => {
  it("rejects self-approval (maker == checker)", () => {
    expect(() => assertSanctionApproverDistinct(MAKER, MAKER)).toThrowError(/MAKER_CHECKER_VIOLATION/);
  });
  it("allows a distinct checker", () => {
    expect(() => assertSanctionApproverDistinct(MAKER, CHECKER)).not.toThrow();
  });
  it("throws a DomainError type", () => {
    expect(() => assertSanctionApproverDistinct(MAKER, MAKER)).toThrowError(DomainError);
  });
});

describe("sanction maker-checker flow (R11) — consumer", () => {
  it("creates pending_approval with NO approved event, then a checker approves", async () => {
    const q = new MemoryQueue();
    registerBudgetConsumers(q);
    await q.start();

    await q.publish(COMMANDS.sanctionCreate, {
      messageId: CREATE_MSG, type: COMMANDS.sanctionCreate,
      tenantId: TENANT, actorId: MAKER, correlationId: "corr-mc", schemaVersion: "1.0",
      payload: { id: SANC, tenantId: TENANT, sanctionNo: "SN-MC-1", purpose: "Office supplies", headId: HEAD, amountMinor: 500000 },
    });
    await waitFor(async () =>
      (await db.select().from(processed).where(eq(processed.messageId, CREATE_MSG))).length === 1);

    let sanc = (await db.select().from(financeSanctions).where(eq(financeSanctions.id, SANC)))[0];
    expect(sanc?.status).toBe("pending_approval");
    // No approval event on create
    let approvedEvents = await db.select().from(outboxMessages)
      .where(eq(outboxMessages.correlationId, "corr-mc"));
    expect(approvedEvents.map((e) => e.eventType)).not.toContain(EVENTS.sanctionApproved);

    // Checker (distinct officer) approves
    await q.publish(COMMANDS.sanctionApprove, {
      messageId: APPROVE_MSG, type: COMMANDS.sanctionApprove,
      tenantId: TENANT, actorId: CHECKER, correlationId: "corr-mc", schemaVersion: "1.0",
      payload: { id: SANC, tenantId: TENANT },
    });
    await waitFor(async () =>
      (await db.select().from(processed).where(eq(processed.messageId, APPROVE_MSG))).length === 1);
    await q.stop();

    sanc = (await db.select().from(financeSanctions).where(eq(financeSanctions.id, SANC)))[0];
    expect(sanc?.status).toBe("approved");
    approvedEvents = await db.select().from(outboxMessages).where(eq(outboxMessages.correlationId, "corr-mc"));
    expect(approvedEvents.map((e) => e.eventType)).toContain(EVENTS.sanctionApproved);
  });

  it("rejects self-approval by the maker (SoD) — sanction stays pending", async () => {
    // seed a pending sanction created by MAKER
    await db.insert(financeSanctions).values({
      id: SANC, tenantId: TENANT, sanctionNo: "SN-MC-2", purpose: "Self approve attempt",
      headId: HEAD, amountMinor: 500000n, currency: "INR", status: "pending_approval",
      createdBy: MAKER, updatedBy: MAKER,
    });
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerBudgetConsumers(q);
    await q.start();

    await q.publish(COMMANDS.sanctionApprove, {
      messageId: SELF_MSG, type: COMMANDS.sanctionApprove,
      tenantId: TENANT, actorId: MAKER, correlationId: "corr-mc", schemaVersion: "1.0",
      payload: { id: SANC, tenantId: TENANT },
    });
    await waitFor(async () => q.dlq.length === 1);
    await q.stop();

    const sanc = (await db.select().from(financeSanctions).where(eq(financeSanctions.id, SANC)))[0];
    expect(sanc?.status).toBe("pending_approval"); // unchanged
    expect(q.dlq[0]?.error).toMatch(/MAKER_CHECKER_VIOLATION/);
  });
});
