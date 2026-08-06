/**
 * G15 — MoU milestone governance: consumer tests
 * (src/modules/milestones/consumer.ts, against real Postgres).
 *
 * Handlers are invoked DIRECTLY rather than through queue.publish(), because
 * MemoryQueue dedupes on messageId before a handler ever runs — so a
 * redelivery, the thing idempotency is actually about, cannot be simulated
 * through the queue. The handlers are not exported individually, so a
 * capturing Queue records what registerMouMilestoneConsumers() subscribes and
 * each call is wrapped in runWithTenant() exactly as withTenantConsumer() does
 * in production, so the FORCE-RLS policies on mou.* and the
 * contracts.contract_milestones tenant_isolation_policy see the same
 * app.tenant_id GUC.
 *
 * What is asserted here:
 *   - markProcessed(tx, msg.messageId) really is the first statement in every
 *     handler's transaction, so a redelivery is a complete no-op (structural
 *     check + behavioural check per handler).
 *   - the happy-path write for all five commands the module handles.
 *   - the outbox event is enqueued in the SAME transaction as the business
 *     write (and is absent when the write did not happen).
 *   - tenant isolation: a message carrying tenant B's id cannot read or write
 *     tenant A's milestones, penalty terms, ledger rows or review schedules.
 *   - optimistic locking on the two mutable rows (contract_milestones,
 *     mou.review_schedules): a stale version never clobbers a newer write.
 *   - MONEY: penalty amounts are bigint minor units end to end. Values above
 *     2^53 survive the round trip exactly, and the computed penalty matches
 *     exact BigInt arithmetic — a Number multiply would give a different
 *     answer, which one of these tests pins explicitly.
 *   - the governance guards the migrations enforce are honoured by the
 *     CONSUMER, not merely by Postgres: the milestone state machine refuses to
 *     move a terminal (met/waived) row, a waiver without a reason is rejected
 *     before it can reach the waiver_complete CHECK, the milestone_code /
 *     term_code / review_code business keys are respected, and the
 *     (tenant, term, occurrence) double-count guard means the same occurrence
 *     is never charged twice and never raises a second recovery event.
 *
 * TEST HYGIENE: every tenant id is a fresh randomUUID() minted by this file
 * and teardown deletes only rows carrying one of those ids (plus the _inbox
 * rows for the message ids this file generated). Nothing is truncated.
 * No PII is written or asserted on — ids, codes and amounts only.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope, Handler, PublishInput, Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { contractMilestones } from "../src/modules/contracts/schema.js";
import { penaltyTerms, penaltyApplications, reviewSchedules } from "../src/modules/milestones/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerMouMilestoneConsumers } from "../src/modules/milestones/consumer.js";
import * as repo from "../src/modules/milestones/repo.js";

const { outboxMessages, processed } = outboxSchema;
const AUDIT_TOPIC = "audit.event.record";

const ACTOR = randomUUID();
const WAIVING_OFFICER = randomUUID();

/** 2^53 + 1 — the smallest integer an IEEE-754 double cannot represent. */
const ABOVE_2_53 = 9_007_199_254_740_993n;

/** Every tenant and message id this file created, so teardown stays scoped. */
const tenants = new Set<string>();
const messageIds = new Set<string>();

function freshTenant(): string {
  const t = randomUUID();
  tenants.add(t);
  return t;
}

function msgId(): string {
  const id = randomUUID();
  messageIds.add(id);
  return id;
}

// ── payload shapes (mirror the casts inside consumer.ts) ────────────────────

interface RegisterPayload {
  id: string;
  tenantId: string;
  contractId: string;
  milestoneCode: string;
  name: string;
  description: string;
  dueDate: string;
  ordinal: number;
  amountMinor: string | null;
  currency: string;
}

interface TransitionPayload {
  id: string;
  tenantId: string;
  contractId: string;
  version: number;
  toStatus: "met" | "missed" | "waived";
  completedAt?: string;
  waiverReason?: string;
}

interface TermCreatePayload {
  id: string;
  tenantId: string;
  contractId: string;
  termCode: string;
  description: string;
  triggerType: string;
  thresholdValue: number;
  penaltyKind: string;
  penaltyAmountMinor: string | null;
  penaltyRateBps: number | null;
  maxPenaltyBps: number;
  currency: string;
}

interface PenaltyApplyPayload {
  tenantId: string;
  penaltyTermId: string;
  milestoneId?: string;
  occurrenceRef: string;
  overdueDays: number;
  milestoneAmountMinor: string;
}

interface ReviewSchedulePayload {
  id: string;
  tenantId: string;
  contractId: string;
  reviewCode: string;
  cadence: string;
  nextReviewDate: string;
  reviewerRole: string;
  notes?: string;
}

interface ReviewCompletePayload {
  id: string;
  tenantId: string;
  version: number;
  notes?: string;
}

// ── capture the registered handlers ─────────────────────────────────────────

type AnyHandler = (msg: CommandEnvelope<unknown>) => Promise<void>;

const handlers = new Map<string, AnyHandler>();
const registrationOrder: string[] = [];

const capturingQueue: Queue = {
  publish: <T>(_topic: string, _input: PublishInput<T>): Promise<string> => Promise.resolve(randomUUID()),
  subscribe: <T>(topic: string, handler: Handler<T>): void => {
    registrationOrder.push(topic);
    handlers.set(topic, handler as unknown as AnyHandler);
  },
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
  healthCheck: () => Promise.resolve({ healthy: true, driver: "memory" as const }),
};

registerMouMilestoneConsumers(capturingQueue);

function handlerFor(topic: string): AnyHandler {
  const h = handlers.get(topic);
  if (!h) throw new Error(`no handler registered for topic '${topic}'`);
  return h;
}

// ── envelope + delivery helpers ─────────────────────────────────────────────

function envelope<T>(
  type: string,
  tenantId: string,
  payload: T,
  opts: { messageId?: string; actorId?: string } = {},
): CommandEnvelope<T> {
  return {
    messageId: opts.messageId ?? msgId(),
    type,
    tenantId,
    actorId: opts.actorId ?? ACTOR,
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload,
  };
}

/** Deliver exactly as withTenantConsumer() would: handler inside the tenant context. */
async function deliver<T>(topic: string, msg: CommandEnvelope<T>): Promise<void> {
  await runWithTenant(msg.tenantId, () => handlerFor(topic)(msg));
}

// ── small assertion helpers (no non-null assertions on collections) ─────────

function only<T>(rows: readonly T[], what: string): T {
  if (rows.length !== 1) {
    throw new Error(`expected exactly one ${what}, got ${rows.length}`);
  }
  const row = rows[0];
  if (row === undefined) throw new Error(`expected exactly one ${what}`);
  return row;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`expected ${what} to be an object`);
  }
  return value as Record<string, unknown>;
}

// ── read helpers ────────────────────────────────────────────────────────────

interface OutboxRow {
  eventType: string;
  payload: Record<string, unknown>;
}

async function outboxFor(tenantId: string): Promise<OutboxRow[]> {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx
        .select({ eventType: outboxMessages.eventType, payload: outboxMessages.payload })
        .from(outboxMessages)
        .where(eq(outboxMessages.tenantId, tenantId)),
    ),
  );
}

async function eventsOfType(tenantId: string, eventType: string): Promise<Array<Record<string, unknown>>> {
  const rows = await outboxFor(tenantId);
  return rows.filter((r) => r.eventType === eventType).map((r) => r.payload);
}

/** The audited actions for a tenant, sorted, so ordering is not asserted. */
async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await outboxFor(tenantId);
  return rows
    .filter((r) => r.eventType === AUDIT_TOPIC)
    .map((r) => String(r.payload.action))
    .sort();
}

function readMilestones(tenantId: string): Promise<Array<typeof contractMilestones.$inferSelect>> {
  return Promise.resolve(
    runWithTenant(tenantId, () =>
      db.transaction((tx) =>
        tx.select().from(contractMilestones).where(eq(contractMilestones.tenantId, tenantId)),
      ),
    ),
  );
}

function readTerms(tenantId: string): Promise<Array<typeof penaltyTerms.$inferSelect>> {
  return Promise.resolve(
    runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(penaltyTerms).where(eq(penaltyTerms.tenantId, tenantId))),
    ),
  );
}

function readApplications(tenantId: string): Promise<Array<typeof penaltyApplications.$inferSelect>> {
  return Promise.resolve(
    runWithTenant(tenantId, () =>
      db.transaction((tx) =>
        tx.select().from(penaltyApplications).where(eq(penaltyApplications.tenantId, tenantId)),
      ),
    ),
  );
}

function readReviews(tenantId: string): Promise<Array<typeof reviewSchedules.$inferSelect>> {
  return Promise.resolve(
    runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(reviewSchedules).where(eq(reviewSchedules.tenantId, tenantId))),
    ),
  );
}

/**
 * True when the inbox recorded the message as processed — i.e. the handler's
 * transaction COMMITTED. A skip path that aborts the transaction would roll
 * this row back and the message would be retried and then dead-lettered.
 */
async function isProcessed(messageId: string): Promise<boolean> {
  const rows = await db.select().from(processed).where(eq(processed.messageId, messageId));
  return rows.length === 1;
}

/** Test-setup only: retire a term so the "inactive" consumer guard can fire. */
async function deactivateTerm(tenantId: string, id: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx
        .update(penaltyTerms)
        .set({ active: false })
        .where(and(eq(penaltyTerms.id, id), eq(penaltyTerms.tenantId, tenantId))),
    ),
  );
}

// ── fixtures ────────────────────────────────────────────────────────────────

function registerPayload(tenantId: string, o: Partial<RegisterPayload> = {}): RegisterPayload {
  return {
    id: randomUUID(),
    tenantId,
    contractId: randomUUID(),
    milestoneCode: `MS-${randomUUID().slice(0, 8)}`,
    name: "Phase 1 handover",
    description: "Site handover with completion certificate",
    dueDate: "2026-06-01",
    ordinal: 1,
    amountMinor: ABOVE_2_53.toString(),
    currency: "INR",
    ...o,
  };
}

/** Register a milestone through the real handler and return its payload. */
async function seedMilestone(tenantId: string, o: Partial<RegisterPayload> = {}): Promise<RegisterPayload> {
  const p = registerPayload(tenantId, o);
  await deliver(COMMANDS.mouMilestoneRegister, envelope(COMMANDS.mouMilestoneRegister, tenantId, p));
  return p;
}

function termPayload(tenantId: string, o: Partial<TermCreatePayload> = {}): TermCreatePayload {
  return {
    id: randomUUID(),
    tenantId,
    contractId: randomUUID(),
    termCode: `PEN-${randomUUID().slice(0, 8)}`,
    description: "Liquidated damages",
    triggerType: "milestone_missed",
    thresholdValue: 7,
    penaltyKind: "percentage",
    penaltyAmountMinor: null,
    penaltyRateBps: 50,
    maxPenaltyBps: 1_000,
    currency: "INR",
    ...o,
  };
}

async function seedTerm(tenantId: string, o: Partial<TermCreatePayload> = {}): Promise<TermCreatePayload> {
  const p = termPayload(tenantId, o);
  await deliver(COMMANDS.mouPenaltyTermCreate, envelope(COMMANDS.mouPenaltyTermCreate, tenantId, p));
  return p;
}

function reviewPayload(tenantId: string, o: Partial<ReviewSchedulePayload> = {}): ReviewSchedulePayload {
  return {
    id: randomUUID(),
    tenantId,
    contractId: randomUUID(),
    reviewCode: `REV-${randomUUID().slice(0, 8)}`,
    cadence: "quarterly",
    nextReviewDate: "2026-04-01",
    reviewerRole: "contract_admin",
    ...o,
  };
}

async function seedReview(tenantId: string, o: Partial<ReviewSchedulePayload> = {}): Promise<ReviewSchedulePayload> {
  const p = reviewPayload(tenantId, o);
  await deliver(COMMANDS.mouReviewSchedule, envelope(COMMANDS.mouReviewSchedule, tenantId, p));
  return p;
}

// ── teardown ────────────────────────────────────────────────────────────────

afterAll(async () => {
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        // penalty_applications first: it carries an FK to penalty_terms.
        await tx.delete(penaltyApplications).where(eq(penaltyApplications.tenantId, tenantId));
        await tx.delete(penaltyTerms).where(eq(penaltyTerms.tenantId, tenantId));
        await tx.delete(reviewSchedules).where(eq(reviewSchedules.tenantId, tenantId));
        await tx.delete(contractMilestones).where(eq(contractMilestones.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
  if (messageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...messageIds]));
  }
  await sqlClient.end();
});

// ══ wiring + the structural idempotency contract ═══════════════════════════

describe("consumer wiring and the idempotency contract", () => {
  it("registers exactly one handler for each of the five MoU commands", () => {
    expect(registrationOrder).toEqual([
      COMMANDS.mouMilestoneRegister,
      COMMANDS.mouMilestoneTransition,
      COMMANDS.mouPenaltyTermCreate,
      COMMANDS.mouPenaltyApply,
      COMMANDS.mouReviewSchedule,
      COMMANDS.mouReviewComplete,
    ]);
    expect(handlers.size).toBe(6);
  });

  it("every db.transaction in consumer.ts opens with the markProcessed guard", () => {
    const src = readFileSync(
      resolvePath(__dirname, "../src/modules/milestones/consumer.ts"),
      "utf8",
    ).split("\n");
    const opens = src
      .map((line, i) => ({ line: line.trim(), i }))
      .filter((l) => l.line.startsWith("await db.transaction(async (tx) => {"));
    expect(opens.length).toBe(6);
    for (const open of opens) {
      const next = (src[open.i + 1] ?? "").trim();
      expect(next, `line ${open.i + 2} of consumer.ts`).toBe(
        "if (!(await markProcessed(tx, msg.messageId))) return;",
      );
    }
  });
});

// ══ contract.mou.milestone.register ════════════════════════════════════════

describe("mouMilestoneRegister", () => {
  it("inserts a pending milestone, emits registered + audit in the same tx", async () => {
    const tenantId = freshTenant();
    const p = await seedMilestone(tenantId);

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.id).toBe(p.id);
    expect(row.contractId).toBe(p.contractId);
    expect(row.milestoneCode).toBe(p.milestoneCode);
    expect(row.title).toBe("Phase 1 handover");
    expect(row.description).toBe("Site handover with completion certificate");
    expect(row.dueDate).toBe("2026-06-01");
    expect(row.ordinal).toBe(1);
    expect(row.status).toBe("pending");
    expect(row.currency).toBe("INR");
    expect(row.version).toBe(1);
    expect(row.createdBy).toBe(ACTOR);
    expect(row.completedAt).toBeNull();
    expect(row.waivedBy).toBeNull();

    const registered = only(await eventsOfType(tenantId, EVENTS.mouMilestoneRegistered), "registered event");
    expect(registered).toMatchObject({
      id: p.id,
      tenantId,
      contractId: p.contractId,
      milestoneCode: p.milestoneCode,
      dueDate: "2026-06-01",
      ordinal: 1,
      currency: "INR",
    });
    expect(await auditActions(tenantId)).toEqual(["mou_milestone_register"]);
  });

  it("MONEY: an amount above 2^53 is stored as an exact bigint, not a float", async () => {
    const tenantId = freshTenant();
    await seedMilestone(tenantId, { amountMinor: ABOVE_2_53.toString() });

    const row = only(await readMilestones(tenantId), "milestone");
    expect(typeof row.amountMinor).toBe("bigint");
    expect(row.amountMinor).toBe(ABOVE_2_53);
    // Proof the value is genuinely outside double range: the nearest double
    // rounds down, so a Number round trip would have lost the trailing 1.
    expect(BigInt(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);
    // …and the event carries it as a decimal STRING, never a JSON number.
    const registered = only(await eventsOfType(tenantId, EVENTS.mouMilestoneRegistered), "registered event");
    expect(registered.amountMinor).toBe("9007199254740993");
  });

  it("a deliverable-only milestone with no amount is stored as 0 minor units", async () => {
    const tenantId = freshTenant();
    await seedMilestone(tenantId, { amountMinor: null });

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.amountMinor).toBe(0n);
  });

  it("IDEMPOTENCY: a redelivery of the same messageId writes no second row and emits no second event", async () => {
    const tenantId = freshTenant();
    const p = registerPayload(tenantId);
    const msg = envelope(COMMANDS.mouMilestoneRegister, tenantId, p);

    await deliver(COMMANDS.mouMilestoneRegister, msg);
    await deliver(COMMANDS.mouMilestoneRegister, msg);

    expect(await readMilestones(tenantId)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneRegistered)).toHaveLength(1);
    expect(await auditActions(tenantId)).toEqual(["mou_milestone_register"]);
  });

  it("GOVERNANCE: a DIFFERENT message reusing the milestone_code is skipped, not duplicated", async () => {
    const tenantId = freshTenant();
    const first = await seedMilestone(tenantId);

    // Same (tenant, contract, code) under a fresh messageId — an operator
    // double-click. uq_contract_milestones_code must stop a second payment
    // milestone for the same deliverable, and no event may be emitted.
    const clash = registerPayload(tenantId, {
      contractId: first.contractId,
      milestoneCode: first.milestoneCode,
    });
    const clashMsg = envelope(COMMANDS.mouMilestoneRegister, tenantId, clash);
    await deliver(COMMANDS.mouMilestoneRegister, clashMsg);

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.id).toBe(first.id);
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneRegistered)).toHaveLength(1);
    expect(await auditActions(tenantId)).toEqual(["mou_milestone_register"]);
    // The skip must COMMIT, not abort: the inbox row survives, so the queue
    // acks the message instead of retrying it three times into the DLQ.
    expect(await isProcessed(clashMsg.messageId)).toBe(true);
  });

  it("TENANT ISOLATION: the same code under another tenant is a separate row and A's row is untouched", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const a = await seedMilestone(owner, { name: "owner milestone" });

    await seedMilestone(stranger, {
      contractId: a.contractId,
      milestoneCode: a.milestoneCode,
      name: "stranger milestone",
    });

    expect(only(await readMilestones(owner), "owner milestone").title).toBe("owner milestone");
    expect(only(await readMilestones(stranger), "stranger milestone").title).toBe("stranger milestone");
    // Each tenant only ever sees its own row.
    expect(await readMilestones(owner)).toHaveLength(1);
    expect(await readMilestones(stranger)).toHaveLength(1);
  });
});

// ══ contract.mou.milestone.transition ══════════════════════════════════════

function transitionMsg(
  tenantId: string,
  p: TransitionPayload,
  opts: { messageId?: string; actorId?: string } = {},
): CommandEnvelope<TransitionPayload> {
  return envelope(COMMANDS.mouMilestoneTransition, tenantId, p, opts);
}

describe("mouMilestoneTransition", () => {
  it("met: stamps completion, bumps the version and emits met + audit", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId);

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, {
        id: ms.id,
        tenantId,
        contractId: ms.contractId,
        version: 1,
        toStatus: "met",
        completedAt: "2026-05-30T10:00:00.000Z",
      }),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("met");
    expect(row.version).toBe(2);
    expect(row.completedAt?.toISOString()).toBe("2026-05-30T10:00:00.000Z");
    expect(row.achievedDate).toBe("2026-05-30");
    expect(row.updatedBy).toBe(ACTOR);

    const met = only(await eventsOfType(tenantId, EVENTS.mouMilestoneMet), "met event");
    expect(met).toMatchObject({
      id: ms.id,
      tenantId,
      contractId: ms.contractId,
      milestoneCode: ms.milestoneCode,
      currency: "INR",
      completedAt: "2026-05-30T10:00:00.000Z",
    });
    // Money on the wire is an exact decimal string of minor units.
    expect(met.amountMinor).toBe("9007199254740993");
    expect(await auditActions(tenantId)).toEqual(["mou_milestone_met", "mou_milestone_register"]);
  });

  it("met: completedAt defaults to now when the command omits it", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId);
    const before = Date.now() - 1_000;

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "met" }),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.completedAt).not.toBeNull();
    expect(row.completedAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before);
  });

  it("missed: emits missed with the due date and a non-negative overdue day count", async () => {
    const tenantId = freshTenant();
    // Due in the past so the overdue arithmetic has something to report.
    const ms = await seedMilestone(tenantId, { dueDate: "2020-01-01" });

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "missed" }),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("missed");
    expect(row.version).toBe(2);
    expect(row.completedAt).toBeNull();

    const missed = only(await eventsOfType(tenantId, EVENTS.mouMilestoneMissed), "missed event");
    expect(missed.dueDate).toBe("2020-01-01");
    expect(typeof missed.overdueDays).toBe("number");
    expect(Number(missed.overdueDays)).toBeGreaterThan(1_800);
  });

  it("waived: records who waived it and why, and emits waived", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { dueDate: "2020-01-01" });
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "missed" }),
    );

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(
        tenantId,
        {
          id: ms.id,
          tenantId,
          contractId: ms.contractId,
          version: 2,
          toStatus: "waived",
          waiverReason: "force majeure — district flood notification 4/2026",
        },
        { actorId: WAIVING_OFFICER },
      ),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("waived");
    expect(row.version).toBe(3);
    expect(row.waivedBy).toBe(WAIVING_OFFICER);
    expect(row.waivedAt).not.toBeNull();
    expect(row.waiverReason).toBe("force majeure — district flood notification 4/2026");

    const waived = only(await eventsOfType(tenantId, EVENTS.mouMilestoneWaived), "waived event");
    expect(waived).toMatchObject({
      id: ms.id,
      tenantId,
      waivedBy: WAIVING_OFFICER,
      waiverReason: "force majeure — district flood notification 4/2026",
    });
  });

  it("GOVERNANCE: a waiver with a blank reason is refused by the consumer, not by the CHECK", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { dueDate: "2020-01-01" });
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "missed" }),
    );

    // assertWaiverAllowed throws before the UPDATE is issued, so the whole
    // transaction (inbox row included) rolls back — the message is retryable,
    // and contract_milestones_waiver_complete_check is never reached.
    await expect(
      deliver(
        COMMANDS.mouMilestoneTransition,
        transitionMsg(tenantId, {
          id: ms.id,
          tenantId,
          contractId: ms.contractId,
          version: 2,
          toStatus: "waived",
          waiverReason: "   ",
        }),
      ),
    ).rejects.toThrow(/WAIVER_REASON_REQUIRED/);

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("missed");
    expect(row.waivedBy).toBeNull();
    expect(row.waiverReason).toBeNull();
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneWaived)).toEqual([]);
  });

  it("GOVERNANCE: a waiver with no reason field at all is refused the same way", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { dueDate: "2020-01-01" });
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "missed" }),
    );

    await expect(
      deliver(
        COMMANDS.mouMilestoneTransition,
        // waiverReason omitted entirely, not merely blank.
        transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 2, toStatus: "waived" }),
      ),
    ).rejects.toThrow(/WAIVER_REASON_REQUIRED/);

    expect(only(await readMilestones(tenantId), "milestone").status).toBe("missed");
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneWaived)).toEqual([]);
  });

  it("GOVERNANCE: a met milestone is immutable — the state machine refuses to move it", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId);
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "met" }),
    );

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 2, toStatus: "missed" }),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("met");
    expect(row.version).toBe(2);
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneMissed)).toEqual([]);
    expect(await auditActions(tenantId)).toEqual(["mou_milestone_met", "mou_milestone_register"]);
  });

  it("GOVERNANCE: a waived milestone is immutable — a late 'met' is refused", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { dueDate: "2020-01-01" });
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "missed" }),
    );
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, {
        id: ms.id,
        tenantId,
        contractId: ms.contractId,
        version: 2,
        toStatus: "waived",
        waiverReason: "excused under clause 14",
      }),
    );

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 3, toStatus: "met" }),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("waived");
    expect(row.version).toBe(3);
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneMet)).toEqual([]);
  });

  it("a missed milestone may still be delivered late (missed → met)", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { dueDate: "2020-01-01" });
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "missed" }),
    );

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 2, toStatus: "met" }),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("met");
    expect(row.version).toBe(3);
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneMet)).toHaveLength(1);
  });

  it("OPTIMISTIC LOCK: a stale version never clobbers the newer write", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { dueDate: "2020-01-01" });
    // Someone moves it to missed first, so the row is now at version 2.
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "missed" }),
    );

    // A command minted against version 1 arrives late. It is a legal
    // transition (missed → met) so the state machine lets it through; only the
    // version predicate stops the lost update.
    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, { id: ms.id, tenantId, contractId: ms.contractId, version: 1, toStatus: "met" }),
    );

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.status).toBe("missed");
    expect(row.version).toBe(2);
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneMet)).toEqual([]);
    expect(await auditActions(tenantId)).toEqual(["mou_milestone_missed", "mou_milestone_register"]);
  });

  it("IDEMPOTENCY: a redelivered transition bumps the version once and emits one event", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId);
    const msg = transitionMsg(tenantId, {
      id: ms.id,
      tenantId,
      contractId: ms.contractId,
      version: 1,
      toStatus: "met",
    });

    await deliver(COMMANDS.mouMilestoneTransition, msg);
    const first = only(await readMilestones(tenantId), "milestone");
    await deliver(COMMANDS.mouMilestoneTransition, msg);

    const after = only(await readMilestones(tenantId), "milestone");
    expect(after.version).toBe(2);
    expect(after.completedAt?.toISOString()).toBe(first.completedAt?.toISOString());
    expect(await eventsOfType(tenantId, EVENTS.mouMilestoneMet)).toHaveLength(1);
  });

  it("a milestone that does not exist is a logged no-op, not a throw", async () => {
    const tenantId = freshTenant();

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(tenantId, {
        id: randomUUID(),
        tenantId,
        contractId: randomUUID(),
        version: 1,
        toStatus: "met",
      }),
    );

    expect(await readMilestones(tenantId)).toEqual([]);
    expect(await outboxFor(tenantId)).toEqual([]);
  });

  it("TENANT ISOLATION: a message carrying tenant B's id cannot transition tenant A's milestone", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const ms = await seedMilestone(owner);

    await deliver(
      COMMANDS.mouMilestoneTransition,
      transitionMsg(stranger, {
        id: ms.id,
        tenantId: stranger,
        contractId: ms.contractId,
        version: 1,
        toStatus: "met",
      }),
    );

    const row = only(await readMilestones(owner), "milestone");
    expect(row.status).toBe("pending");
    expect(row.version).toBe(1);
    expect(await readMilestones(stranger)).toEqual([]);
    // No event for either tenant: the row was simply not visible.
    expect(await eventsOfType(owner, EVENTS.mouMilestoneMet)).toEqual([]);
    expect(await outboxFor(stranger)).toEqual([]);
  });
});

// ══ contract.mou.penalty_term.create ═══════════════════════════════════════

describe("mouPenaltyTermCreate", () => {
  it("inserts a percentage term, emits created + audit in the same tx", async () => {
    const tenantId = freshTenant();
    const p = await seedTerm(tenantId);

    const row = only(await readTerms(tenantId), "penalty term");
    expect(row.id).toBe(p.id);
    expect(row.termCode).toBe(p.termCode);
    expect(row.triggerType).toBe("milestone_missed");
    expect(row.thresholdValue).toBe(7);
    expect(row.penaltyKind).toBe("percentage");
    expect(row.penaltyRateBps).toBe(50);
    // A percentage term stores no bigint amount — the representation CHECK.
    expect(row.penaltyAmountMinor).toBeNull();
    expect(row.maxPenaltyBps).toBe(1_000);
    expect(row.active).toBe(true);
    expect(row.version).toBe(1);

    const created = only(await eventsOfType(tenantId, EVENTS.mouPenaltyTermCreated), "term created event");
    expect(created).toMatchObject({
      id: p.id,
      tenantId,
      termCode: p.termCode,
      triggerType: "milestone_missed",
      penaltyKind: "percentage",
      penaltyRateBps: 50,
      maxPenaltyBps: 1_000,
    });
    expect(created.penaltyAmountMinor).toBeNull();
    expect(await auditActions(tenantId)).toEqual(["mou_penalty_term_create"]);
  });

  it("MONEY: a fixed term's amount above 2^53 round-trips as an exact bigint", async () => {
    const tenantId = freshTenant();
    await seedTerm(tenantId, {
      penaltyKind: "fixed",
      penaltyRateBps: null,
      penaltyAmountMinor: ABOVE_2_53.toString(),
    });

    const row = only(await readTerms(tenantId), "penalty term");
    expect(typeof row.penaltyAmountMinor).toBe("bigint");
    expect(row.penaltyAmountMinor).toBe(ABOVE_2_53);
    expect(row.penaltyRateBps).toBeNull();

    const created = only(await eventsOfType(tenantId, EVENTS.mouPenaltyTermCreated), "term created event");
    expect(created.penaltyAmountMinor).toBe("9007199254740993");
  });

  it("IDEMPOTENCY: a redelivered create writes one row and emits one event", async () => {
    const tenantId = freshTenant();
    const p = termPayload(tenantId);
    const msg = envelope(COMMANDS.mouPenaltyTermCreate, tenantId, p);

    await deliver(COMMANDS.mouPenaltyTermCreate, msg);
    await deliver(COMMANDS.mouPenaltyTermCreate, msg);

    expect(await readTerms(tenantId)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.mouPenaltyTermCreated)).toHaveLength(1);
  });

  it("GOVERNANCE: a DIFFERENT message reusing the term_code is skipped, not duplicated", async () => {
    const tenantId = freshTenant();
    const first = await seedTerm(tenantId);

    const clash = termPayload(tenantId, { contractId: first.contractId, termCode: first.termCode });
    const clashMsg = envelope(COMMANDS.mouPenaltyTermCreate, tenantId, clash);
    await deliver(COMMANDS.mouPenaltyTermCreate, clashMsg);

    expect(only(await readTerms(tenantId), "penalty term").id).toBe(first.id);
    expect(await eventsOfType(tenantId, EVENTS.mouPenaltyTermCreated)).toHaveLength(1);
    expect(await auditActions(tenantId)).toEqual(["mou_penalty_term_create"]);
    expect(await isProcessed(clashMsg.messageId)).toBe(true);
  });

  it("TENANT ISOLATION: the same term_code under another tenant is a separate row", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const a = await seedTerm(owner, { penaltyRateBps: 50 });

    await seedTerm(stranger, { contractId: a.contractId, termCode: a.termCode, penaltyRateBps: 900 });

    expect(only(await readTerms(owner), "owner term").penaltyRateBps).toBe(50);
    expect(only(await readTerms(stranger), "stranger term").penaltyRateBps).toBe(900);
  });
});

// ══ contract.mou.penalty.apply ═════════════════════════════════════════════

describe("mouPenaltyApply", () => {
  it("writes the ledger row, reflects the penalty on the milestone and emits applied", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { amountMinor: "100000000" });
    const term = await seedTerm(tenantId, {
      penaltyKind: "per_day",
      penaltyRateBps: null,
      penaltyAmountMinor: "1000000",
      thresholdValue: 7,
      maxPenaltyBps: 1_000,
    });

    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, tenantId, {
        tenantId,
        penaltyTermId: term.id,
        milestoneId: ms.id,
        occurrenceRef: ms.id,
        overdueDays: 30,
        milestoneAmountMinor: "100000000",
      }),
    );

    const app = only(await readApplications(tenantId), "penalty application");
    expect(app.penaltyTermId).toBe(term.id);
    expect(app.milestoneId).toBe(ms.id);
    expect(app.contractId).toBe(term.contractId);
    expect(app.occurrenceKey).toBe(`milestone:${ms.id}`);
    expect(app.currency).toBe("INR");
    // 30 days late less a 7-day grace = 23 chargeable days at 10_00_000 paise
    // = 2,30,00,000 paise uncapped, capped at 10 % of 10,00,00,000 paise.
    expect(typeof app.computedAmountMinor).toBe("bigint");
    expect(app.computedAmountMinor).toBe(10_000_000n);

    const basis = asRecord(app.basis, "basis");
    expect(basis).toMatchObject({
      penaltyKind: "per_day",
      thresholdValue: 7,
      overdueDays: 30,
      chargeableDays: 23,
      capped: true,
    });
    // Every money figure in the audit basis is a decimal string, not a number.
    expect(basis.milestoneAmountMinor).toBe("100000000");
    expect(basis.uncappedMinor).toBe("23000000");
    expect(basis.capMinor).toBe("10000000");

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.penaltyMinor).toBe(10_000_000n);
    expect(row.netPayableMinor).toBe(90_000_000n);

    const applied = only(await eventsOfType(tenantId, EVENTS.mouPenaltyApplied), "penalty applied event");
    expect(applied).toMatchObject({
      id: app.id,
      tenantId,
      contractId: term.contractId,
      penaltyTermId: term.id,
      milestoneId: ms.id,
      occurrenceKey: `milestone:${ms.id}`,
      currency: "INR",
      capped: true,
      chargeableDays: 23,
    });
    expect(applied.computedAmountMinor).toBe("10000000");
    expect(await auditActions(tenantId)).toEqual([
      "mou_milestone_register",
      "mou_penalty_apply",
      "mou_penalty_term_create",
    ]);
  });

  it("MONEY: a percentage penalty above 2^53 is exact — a Number multiply would not be", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { amountMinor: ABOVE_2_53.toString() });
    // 100 % of the milestone, capped at 100 %: the penalty IS the amount, so
    // the trailing 1 of 2^53 + 1 must survive the whole computation.
    const term = await seedTerm(tenantId, { penaltyRateBps: 10_000, maxPenaltyBps: 10_000 });

    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, tenantId, {
        tenantId,
        penaltyTermId: term.id,
        milestoneId: ms.id,
        occurrenceRef: ms.id,
        overdueDays: 10,
        milestoneAmountMinor: ABOVE_2_53.toString(),
      }),
    );

    const app = only(await readApplications(tenantId), "penalty application");
    expect(app.computedAmountMinor).toBe(ABOVE_2_53);
    // The same value in doubles loses the last paisa before any arithmetic
    // even starts, which is why nothing on this path is ever cast to Number.
    expect(Number(ABOVE_2_53)).toBe(9_007_199_254_740_992);

    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.penaltyMinor).toBe(ABOVE_2_53);
    expect(row.netPayableMinor).toBe(0n);

    const applied = only(await eventsOfType(tenantId, EVENTS.mouPenaltyApplied), "penalty applied event");
    expect(applied.computedAmountMinor).toBe("9007199254740993");
  });

  it("MONEY: a sub-paisa percentage truncates toward zero, in the payer's favour", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { amountMinor: "199" });
    const term = await seedTerm(tenantId, { penaltyRateBps: 50, maxPenaltyBps: 10_000 });

    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, tenantId, {
        tenantId,
        penaltyTermId: term.id,
        milestoneId: ms.id,
        occurrenceRef: ms.id,
        overdueDays: 30,
        milestoneAmountMinor: "199",
      }),
    );

    // 199 * 50 / 10000 = 0.995 paise → 0, never 1 and never 0.995.
    const app = only(await readApplications(tenantId), "penalty application");
    expect(app.computedAmountMinor).toBe(0n);
    expect(only(await readMilestones(tenantId), "milestone").netPayableMinor).toBe(199n);
  });

  it("DOUBLE-COUNT GUARD: a second message for the same occurrence charges nothing and emits nothing", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { amountMinor: "100000000" });
    const term = await seedTerm(tenantId, { penaltyRateBps: 50, maxPenaltyBps: 10_000 });
    const apply = (): Promise<void> =>
      deliver<PenaltyApplyPayload>(
        COMMANDS.mouPenaltyApply,
        envelope(COMMANDS.mouPenaltyApply, tenantId, {
          tenantId,
          penaltyTermId: term.id,
          milestoneId: ms.id,
          occurrenceRef: ms.id,
          overdueDays: 30,
          milestoneAmountMinor: "100000000",
        }),
      );

    await apply();
    // Fresh messageId, so the inbox does not stop it — only
    // uq_penalty_applications_occurrence does.
    await apply();

    expect(await readApplications(tenantId)).toHaveLength(1);
    // Critically: no second event, so finance-service never raises a second
    // recovery against the vendor.
    expect(await eventsOfType(tenantId, EVENTS.mouPenaltyApplied)).toHaveLength(1);
    expect(only(await readMilestones(tenantId), "milestone").penaltyMinor).toBe(500_000n);
  });

  it("IDEMPOTENCY: a redelivered apply writes one ledger row and emits one event", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { amountMinor: "100000000" });
    const term = await seedTerm(tenantId, { penaltyRateBps: 50, maxPenaltyBps: 10_000 });
    const msg = envelope<PenaltyApplyPayload>(COMMANDS.mouPenaltyApply, tenantId, {
      tenantId,
      penaltyTermId: term.id,
      milestoneId: ms.id,
      occurrenceRef: ms.id,
      overdueDays: 30,
      milestoneAmountMinor: "100000000",
    });

    await deliver(COMMANDS.mouPenaltyApply, msg);
    await deliver(COMMANDS.mouPenaltyApply, msg);

    expect(await readApplications(tenantId)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.mouPenaltyApplied)).toHaveLength(1);
  });

  it("an SLA breach not tied to a milestone keys on 'sla:' and updates no milestone", async () => {
    const tenantId = freshTenant();
    const ms = await seedMilestone(tenantId, { amountMinor: "100000000" });
    const term = await seedTerm(tenantId, {
      triggerType: "sla_breached",
      penaltyKind: "fixed",
      penaltyRateBps: null,
      penaltyAmountMinor: "250000",
      thresholdValue: 0,
      maxPenaltyBps: 10_000,
    });

    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, tenantId, {
        tenantId,
        penaltyTermId: term.id,
        occurrenceRef: "2026-Q1",
        overdueDays: 0,
        milestoneAmountMinor: "100000000",
      }),
    );

    const app = only(await readApplications(tenantId), "penalty application");
    expect(app.occurrenceKey).toBe("sla:2026-Q1");
    expect(app.milestoneId).toBeNull();
    expect(app.computedAmountMinor).toBe(250_000n);
    // The unrelated milestone is left alone.
    const row = only(await readMilestones(tenantId), "milestone");
    expect(row.id).toBe(ms.id);
    expect(row.penaltyMinor).toBe(0n);
    expect(row.netPayableMinor).toBeNull();
  });

  it("a penalty term that does not exist is a logged no-op", async () => {
    const tenantId = freshTenant();

    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, tenantId, {
        tenantId,
        penaltyTermId: randomUUID(),
        occurrenceRef: randomUUID(),
        overdueDays: 3,
        milestoneAmountMinor: "1000",
      }),
    );

    expect(await readApplications(tenantId)).toEqual([]);
    expect(await outboxFor(tenantId)).toEqual([]);
  });

  it("GOVERNANCE: a retired (inactive) term charges nothing", async () => {
    const tenantId = freshTenant();
    const term = await seedTerm(tenantId, { penaltyRateBps: 50, maxPenaltyBps: 10_000 });
    await deactivateTerm(tenantId, term.id);

    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, tenantId, {
        tenantId,
        penaltyTermId: term.id,
        occurrenceRef: randomUUID(),
        overdueDays: 30,
        milestoneAmountMinor: "100000000",
      }),
    );

    expect(await readApplications(tenantId)).toEqual([]);
    expect(await eventsOfType(tenantId, EVENTS.mouPenaltyApplied)).toEqual([]);
  });

  it("TENANT ISOLATION: tenant B cannot apply tenant A's term", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const term = await seedTerm(owner, { penaltyRateBps: 50, maxPenaltyBps: 10_000 });

    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, stranger, {
        tenantId: stranger,
        penaltyTermId: term.id,
        occurrenceRef: randomUUID(),
        overdueDays: 30,
        milestoneAmountMinor: "100000000",
      }),
    );

    expect(await readApplications(stranger)).toEqual([]);
    expect(await readApplications(owner)).toEqual([]);
    expect(await outboxFor(stranger)).toEqual([]);
  });

  it("TENANT ISOLATION: a penalty booked by tenant B never debits tenant A's milestone", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const ownerMilestone = await seedMilestone(owner, { amountMinor: "100000000" });
    const strangerTerm = await seedTerm(stranger, { penaltyRateBps: 50, maxPenaltyBps: 10_000 });

    // B's own term, but pointing at A's milestone id — the reflection UPDATE is
    // tenant-scoped, so it must match nothing.
    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, stranger, {
        tenantId: stranger,
        penaltyTermId: strangerTerm.id,
        milestoneId: ownerMilestone.id,
        occurrenceRef: ownerMilestone.id,
        overdueDays: 30,
        milestoneAmountMinor: "100000000",
      }),
    );

    // B got its ledger row…
    expect(await readApplications(stranger)).toHaveLength(1);
    // …and A's money is untouched.
    const row = only(await readMilestones(owner), "milestone");
    expect(row.penaltyMinor).toBe(0n);
    expect(row.netPayableMinor).toBeNull();
    expect(row.version).toBe(1);
  });
});

// ══ contract.mou.review.schedule ═══════════════════════════════════════════

describe("mouReviewSchedule", () => {
  it("inserts a scheduled review and emits scheduled + audit", async () => {
    const tenantId = freshTenant();
    const p = await seedReview(tenantId, { notes: "first cycle" });

    const row = only(await readReviews(tenantId), "review schedule");
    expect(row.id).toBe(p.id);
    expect(row.contractId).toBe(p.contractId);
    expect(row.reviewCode).toBe(p.reviewCode);
    expect(row.cadence).toBe("quarterly");
    expect(row.nextReviewDate).toBe("2026-04-01");
    expect(row.reviewerRole).toBe("contract_admin");
    expect(row.status).toBe("scheduled");
    expect(row.notes).toBe("first cycle");
    expect(row.lastReviewedAt).toBeNull();
    expect(row.version).toBe(1);

    const scheduled = only(await eventsOfType(tenantId, EVENTS.mouReviewScheduled), "review scheduled event");
    expect(scheduled).toMatchObject({
      id: p.id,
      tenantId,
      contractId: p.contractId,
      reviewCode: p.reviewCode,
      cadence: "quarterly",
      nextReviewDate: "2026-04-01",
      reviewerRole: "contract_admin",
    });
    expect(await auditActions(tenantId)).toEqual(["mou_review_schedule"]);
  });

  it("stores a null note when the command omits it", async () => {
    const tenantId = freshTenant();
    await seedReview(tenantId);
    expect(only(await readReviews(tenantId), "review schedule").notes).toBeNull();
  });

  it("IDEMPOTENCY: a redelivered schedule writes one row and emits one event", async () => {
    const tenantId = freshTenant();
    const msg = envelope(COMMANDS.mouReviewSchedule, tenantId, reviewPayload(tenantId));

    await deliver(COMMANDS.mouReviewSchedule, msg);
    await deliver(COMMANDS.mouReviewSchedule, msg);

    expect(await readReviews(tenantId)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.mouReviewScheduled)).toHaveLength(1);
  });

  it("GOVERNANCE: a DIFFERENT message reusing the review_code is skipped, not duplicated", async () => {
    const tenantId = freshTenant();
    const first = await seedReview(tenantId);

    const clash = reviewPayload(tenantId, { contractId: first.contractId, reviewCode: first.reviewCode });
    const clashMsg = envelope(COMMANDS.mouReviewSchedule, tenantId, clash);
    await deliver(COMMANDS.mouReviewSchedule, clashMsg);

    expect(only(await readReviews(tenantId), "review schedule").id).toBe(first.id);
    expect(await eventsOfType(tenantId, EVENTS.mouReviewScheduled)).toHaveLength(1);
    expect(await isProcessed(clashMsg.messageId)).toBe(true);
  });

  it("TENANT ISOLATION: the same review_code under another tenant is a separate row", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const a = await seedReview(owner, { cadence: "quarterly" });

    await seedReview(stranger, { contractId: a.contractId, reviewCode: a.reviewCode, cadence: "annual" });

    expect(only(await readReviews(owner), "owner review").cadence).toBe("quarterly");
    expect(only(await readReviews(stranger), "stranger review").cadence).toBe("annual");
  });
});

// ══ contract.mou.review.complete ═══════════════════════════════════════════

function completeMsg(
  tenantId: string,
  p: ReviewCompletePayload,
  opts: { messageId?: string } = {},
): CommandEnvelope<ReviewCompletePayload> {
  return envelope(COMMANDS.mouReviewComplete, tenantId, p, opts);
}

describe("mouReviewComplete", () => {
  it("stamps the review, advances the cadence and emits completed + audit", async () => {
    const tenantId = freshTenant();
    const p = await seedReview(tenantId, { cadence: "quarterly", nextReviewDate: "2026-04-01" });

    await deliver(
      COMMANDS.mouReviewComplete,
      completeMsg(tenantId, { id: p.id, tenantId, version: 1, notes: "cycle closed, no action points" }),
    );

    const row = only(await readReviews(tenantId), "review schedule");
    expect(row.lastReviewedAt).not.toBeNull();
    // Advanced from the SCHEDULED date, not from today, so a late review does
    // not drag the whole cadence forward.
    expect(row.nextReviewDate).toBe("2026-07-01");
    expect(row.status).toBe("scheduled");
    expect(row.notes).toBe("cycle closed, no action points");
    expect(row.version).toBe(2);
    expect(row.updatedBy).toBe(ACTOR);

    const completed = only(await eventsOfType(tenantId, EVENTS.mouReviewCompleted), "review completed event");
    expect(completed).toMatchObject({
      id: p.id,
      tenantId,
      contractId: p.contractId,
      reviewCode: p.reviewCode,
      nextReviewDate: "2026-07-01",
    });
    expect(typeof completed.reviewedAt).toBe("string");
    expect(await auditActions(tenantId)).toEqual(["mou_review_complete", "mou_review_schedule"]);
  });

  it("month-end cadence clamps rather than rolling into the next month", async () => {
    const tenantId = freshTenant();
    const p = await seedReview(tenantId, { cadence: "monthly", nextReviewDate: "2026-01-31" });

    await deliver(COMMANDS.mouReviewComplete, completeMsg(tenantId, { id: p.id, tenantId, version: 1 }));

    expect(only(await readReviews(tenantId), "review schedule").nextReviewDate).toBe("2026-02-28");
  });

  it("omitting notes leaves the existing note intact", async () => {
    const tenantId = freshTenant();
    const p = await seedReview(tenantId, { notes: "standing note" });

    await deliver(COMMANDS.mouReviewComplete, completeMsg(tenantId, { id: p.id, tenantId, version: 1 }));

    expect(only(await readReviews(tenantId), "review schedule").notes).toBe("standing note");
  });

  it("OPTIMISTIC LOCK: a stale version never re-advances the cadence", async () => {
    const tenantId = freshTenant();
    const p = await seedReview(tenantId, { cadence: "quarterly", nextReviewDate: "2026-04-01" });
    await deliver(COMMANDS.mouReviewComplete, completeMsg(tenantId, { id: p.id, tenantId, version: 1 }));

    // A second completion minted against version 1 arrives late.
    await deliver(COMMANDS.mouReviewComplete, completeMsg(tenantId, { id: p.id, tenantId, version: 1 }));

    const row = only(await readReviews(tenantId), "review schedule");
    expect(row.nextReviewDate).toBe("2026-07-01");
    expect(row.version).toBe(2);
    expect(await eventsOfType(tenantId, EVENTS.mouReviewCompleted)).toHaveLength(1);
  });

  it("IDEMPOTENCY: a redelivered completion advances the cadence once", async () => {
    const tenantId = freshTenant();
    const p = await seedReview(tenantId, { cadence: "annual", nextReviewDate: "2026-04-01" });
    const msg = completeMsg(tenantId, { id: p.id, tenantId, version: 1 });

    await deliver(COMMANDS.mouReviewComplete, msg);
    const first = only(await readReviews(tenantId), "review schedule");
    await deliver(COMMANDS.mouReviewComplete, msg);

    const after = only(await readReviews(tenantId), "review schedule");
    expect(after.nextReviewDate).toBe("2027-04-01");
    expect(after.version).toBe(2);
    expect(after.lastReviewedAt?.toISOString()).toBe(first.lastReviewedAt?.toISOString());
    expect(await eventsOfType(tenantId, EVENTS.mouReviewCompleted)).toHaveLength(1);
  });

  it("a review schedule that does not exist is a logged no-op", async () => {
    const tenantId = freshTenant();

    await deliver(COMMANDS.mouReviewComplete, completeMsg(tenantId, { id: randomUUID(), tenantId, version: 1 }));

    expect(await readReviews(tenantId)).toEqual([]);
    expect(await outboxFor(tenantId)).toEqual([]);
  });

  it("GOVERNANCE: a cancelled review cycle cannot be completed", async () => {
    const tenantId = freshTenant();
    const p = await seedReview(tenantId);
    await runWithTenant(tenantId, () =>
      db.transaction((tx) =>
        tx
          .update(reviewSchedules)
          .set({ status: "cancelled" })
          .where(and(eq(reviewSchedules.id, p.id), eq(reviewSchedules.tenantId, tenantId))),
      ),
    );

    await deliver(COMMANDS.mouReviewComplete, completeMsg(tenantId, { id: p.id, tenantId, version: 1 }));

    const row = only(await readReviews(tenantId), "review schedule");
    expect(row.status).toBe("cancelled");
    expect(row.nextReviewDate).toBe("2026-04-01");
    expect(row.lastReviewedAt).toBeNull();
    expect(await eventsOfType(tenantId, EVENTS.mouReviewCompleted)).toEqual([]);
  });

  it("TENANT ISOLATION: tenant B cannot complete tenant A's review cycle", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const p = await seedReview(owner, { cadence: "quarterly", nextReviewDate: "2026-04-01" });

    await deliver(COMMANDS.mouReviewComplete, completeMsg(stranger, { id: p.id, tenantId: stranger, version: 1 }));

    const row = only(await readReviews(owner), "review schedule");
    expect(row.nextReviewDate).toBe("2026-04-01");
    expect(row.lastReviewedAt).toBeNull();
    expect(row.version).toBe(1);
    expect(await outboxFor(stranger)).toEqual([]);
  });
});

// ══ repo reads see exactly what the consumer wrote ══════════════════════════

describe("repo reads (RLS-scoped) over consumer-written rows", () => {
  it("finds and lists milestones for the owning tenant only", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const first = await seedMilestone(owner, { ordinal: 1, dueDate: "2026-06-01" });
    const second = await seedMilestone(owner, { ordinal: 2, dueDate: "2026-09-01", contractId: first.contractId });
    await seedMilestone(stranger);

    const found = await runWithTenant(owner, () => repo.findMilestoneById(first.id, owner));
    expect(found?.id).toBe(first.id);
    expect(found?.amountMinor).toBe(ABOVE_2_53);

    // A cross-tenant lookup finds nothing even with the right primary key.
    expect(await runWithTenant(stranger, () => repo.findMilestoneById(first.id, stranger))).toBeUndefined();

    const listed = await runWithTenant(owner, () =>
      repo.listMilestones(owner, { contractId: first.contractId, limit: 50, offset: 0 }),
    );
    expect(listed.total).toBe(2);
    expect(listed.data.map((r) => r.id)).toEqual([first.id, second.id]);

    const filtered = await runWithTenant(owner, () =>
      repo.listMilestones(owner, { status: "met", limit: 50, offset: 0 }),
    );
    expect(filtered).toEqual({ data: [], total: 0 });
  });

  it("finds and lists penalty terms and the application ledger", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const ms = await seedMilestone(owner, { amountMinor: "100000000" });
    const term = await seedTerm(owner, { penaltyRateBps: 50, maxPenaltyBps: 10_000 });
    await seedTerm(owner, { triggerType: "sla_breached", contractId: term.contractId, penaltyRateBps: 25 });
    await deliver<PenaltyApplyPayload>(
      COMMANDS.mouPenaltyApply,
      envelope(COMMANDS.mouPenaltyApply, owner, {
        tenantId: owner,
        penaltyTermId: term.id,
        milestoneId: ms.id,
        occurrenceRef: ms.id,
        overdueDays: 30,
        milestoneAmountMinor: "100000000",
      }),
    );

    const found = await runWithTenant(owner, () => repo.findPenaltyTermById(term.id, owner));
    expect(found?.termCode).toBe(term.termCode);
    expect(await runWithTenant(stranger, () => repo.findPenaltyTermById(term.id, stranger))).toBeUndefined();

    const allTerms = await runWithTenant(owner, () =>
      repo.listPenaltyTerms(owner, { contractId: term.contractId, limit: 50, offset: 0 }),
    );
    expect(allTerms.total).toBe(2);

    const slaOnly = await runWithTenant(owner, () =>
      repo.listPenaltyTerms(owner, { triggerType: "sla_breached", limit: 50, offset: 0 }),
    );
    expect(slaOnly.total).toBe(1);

    const ledger = await runWithTenant(owner, () =>
      repo.listPenaltyApplications(owner, { contractId: term.contractId, limit: 50, offset: 0 }),
    );
    expect(ledger.total).toBe(1);
    expect(only(ledger.data, "ledger row").computedAmountMinor).toBe(500_000n);

    const strangerLedger = await runWithTenant(stranger, () =>
      repo.listPenaltyApplications(stranger, { limit: 50, offset: 0 }),
    );
    expect(strangerLedger).toEqual({ data: [], total: 0 });
  });

  it("finds and lists review schedules", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const first = await seedReview(owner, { nextReviewDate: "2026-04-01" });
    await seedReview(owner, { contractId: first.contractId, nextReviewDate: "2026-07-01" });

    const found = await runWithTenant(owner, () => repo.findReviewScheduleById(first.id, owner));
    expect(found?.reviewCode).toBe(first.reviewCode);
    expect(await runWithTenant(stranger, () => repo.findReviewScheduleById(first.id, stranger))).toBeUndefined();

    const listed = await runWithTenant(owner, () =>
      repo.listReviewSchedules(owner, { contractId: first.contractId, status: "scheduled", limit: 50, offset: 0 }),
    );
    expect(listed.total).toBe(2);
    expect(only(listed.data.slice(0, 1), "first review").nextReviewDate).toBe("2026-04-01");

    const paged = await runWithTenant(owner, () =>
      repo.listReviewSchedules(owner, { limit: 1, offset: 1 }),
    );
    expect(paged.total).toBe(2);
    expect(paged.data).toHaveLength(1);
  });
});
