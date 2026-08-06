/**
 * G18 — outcome capture with reason codes: CONSUMER tests
 * (src/modules/outcomes/consumer.ts, against real Postgres).
 *
 * Handlers are invoked DIRECTLY rather than through queue.publish(), because
 * MemoryQueue dedupes on messageId before a handler ever runs — so a redelivery,
 * the thing idempotency is actually about, cannot be simulated through the queue.
 * The handlers are not exported individually, so a capturing Queue records what
 * registerOutcomeConsumers() subscribes, and every call is wrapped in
 * runWithTenant() exactly as the real queue decorator does in production, so the
 * RLS policies on crm.outcome_reason_codes and crm.interaction_outcomes see the
 * same app.tenant_id GUC.
 *
 * What is asserted here:
 *   - markProcessed(tx, msg.messageId) really is the first statement in every
 *     handler's transaction (structural check + a behavioural redelivery check
 *     per handler), so a redelivery is a complete no-op.
 *   - the happy-path write for all four commands.
 *   - the outbox event is enqueued in the SAME transaction as the business write,
 *     and is ABSENT whenever the write did not happen. That matters more here than
 *     usual: crm.interaction_outcome.recorded is the propensity-model feed, so an
 *     event without a row (or two events for one outcome) is corrupt training data.
 *   - tenant isolation: a message carrying tenant B's id can neither read nor write
 *     tenant A's reason codes or outcomes, and the same business key under another
 *     tenant is a separate row.
 *   - optimistic locking on the mutable row (outcome_reason_codes): a stale version
 *     never clobbers a newer write, and the conflict is audited, not thrown.
 *   - duplicate business keys are skipped via onConflictDoNothing + returning() and
 *     the skip COMMITS, so the queue acks instead of dead-lettering.
 *   - the domain rules are enforced by the CONSUMER, not merely by the CHECK
 *     constraints in migration 0090: a violation is audited and skipped, because
 *     tripping a CHECK would roll back the inbox row and dead-letter a command that
 *     is a validation failure rather than a fault.
 *   - MONEY: amounts are bigint minor units end to end. A value above 2^53 survives
 *     the round trip exactly and leaves on the wire as a decimal STRING.
 *
 * TEST HYGIENE: every tenant id is a fresh randomUUID() minted by this file, every
 * reason-code CATEGORY is unique to one test (canonical rows are visible to all
 * tenants by design, so they are scoped by category instead), and teardown deletes
 * only rows carrying one of those ids/categories plus the _inbox rows for the
 * message ids generated here. Nothing is truncated. No PII is written or asserted
 * on — ids, codes and amounts only.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq, and, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope, Handler, PublishInput, Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerOutcomeConsumers } from "../src/modules/outcomes/consumer.js";
import {
  outcomeReasonCodes,
  interactionOutcomes,
  PLATFORM_TENANT_ID,
  type OutcomeType,
  type SubjectType,
} from "../src/modules/outcomes/schema.js";

const { outboxMessages, processed } = outboxSchema;
const AUDIT_TOPIC = "audit.event.record";

const ACTOR = randomUUID();

/** 2^53 + 1 — the smallest integer an IEEE-754 double cannot represent. */
const ABOVE_2_53 = 9_007_199_254_740_993n;

const tenants = new Set<string>();
const categories = new Set<string>();
const messageIds = new Set<string>();

function freshTenant(): string {
  const t = randomUUID();
  tenants.add(t);
  return t;
}

/** Unique per test: canonical rows are visible to EVERY tenant, so tenant scoping
 *  alone would not isolate them from a concurrent run. */
function freshCategory(): string {
  const c = `interaction_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  categories.add(c);
  return c;
}

function msgId(): string {
  const id = randomUUID();
  messageIds.add(id);
  return id;
}

// ── payload shapes (mirror the interfaces inside consumer.ts) ────────────────

interface CreateCodePayload {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  description: string | null;
  category: string;
  appliesTo: OutcomeType[];
  governance: "canonical" | "tenant";
  versionNumber: number;
  active: boolean;
  ordinal: number;
}

interface UpdateCodePayload {
  id: string;
  tenantId: string;
  label?: string;
  description?: string | null;
  appliesTo?: OutcomeType[];
  ordinal?: number;
  active?: boolean;
  version: number;
}

interface RecordOutcomePayload {
  id: string;
  tenantId: string;
  subjectType: SubjectType;
  subjectId: string;
  outcomeRef: string;
  outcomeType: OutcomeType;
  reasonCodeId: string | null;
  productId: string | null;
  amountMinor: string | null;
  currency: string | null;
  followUpNextActionId: string | null;
  occurredAt: string;
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

registerOutcomeConsumers(capturingQueue);

function handlerFor(topic: string): AnyHandler {
  const h = handlers.get(topic);
  if (!h) throw new Error(`no handler registered for topic '${topic}'`);
  return h;
}

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

/** Deliver exactly as the queue's tenant decorator would. */
async function deliver<T>(topic: string, msg: CommandEnvelope<T>): Promise<void> {
  await runWithTenant(msg.tenantId, () => handlerFor(topic)(msg));
}

// ── small assertion helpers ─────────────────────────────────────────────────

function only<T>(rows: readonly T[], what: string): T {
  if (rows.length !== 1) throw new Error(`expected exactly one ${what}, got ${rows.length}`);
  const row = rows[0];
  if (row === undefined) throw new Error(`expected exactly one ${what}`);
  return row;
}

// ── read helpers ────────────────────────────────────────────────────────────

interface OutboxRow {
  eventType: string;
  payload: Record<string, unknown>;
}

async function outboxFor(tenantId: string): Promise<OutboxRow[]> {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.select({ eventType: outboxMessages.eventType, payload: outboxMessages.payload })
        .from(outboxMessages)
        .where(eq(outboxMessages.tenantId, tenantId)),
    ),
  ) as unknown as Promise<OutboxRow[]>;
}

async function eventsOfType(tenantId: string, eventType: string): Promise<Array<Record<string, unknown>>> {
  const rows = await outboxFor(tenantId);
  return rows.filter((r) => r.eventType === eventType).map((r) => r.payload);
}

/** Audited (action, outcome) pairs for a tenant, sorted so ordering is not asserted. */
async function auditEntries(tenantId: string): Promise<string[]> {
  const rows = await outboxFor(tenantId);
  return rows
    .filter((r) => r.eventType === AUDIT_TOPIC)
    .map((r) => `${String(r.payload.action)}:${String(r.payload.outcome)}`)
    .sort();
}

function readCodes(tenantId: string, category: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.select().from(outcomeReasonCodes).where(and(
        eq(outcomeReasonCodes.tenantId, tenantId),
        eq(outcomeReasonCodes.category, category),
      )),
    ),
  );
}

function readOutcomes(tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.select().from(interactionOutcomes).where(eq(interactionOutcomes.tenantId, tenantId)),
    ),
  );
}

/**
 * True when the inbox recorded the message as processed — i.e. the handler's
 * transaction COMMITTED. A skip path that aborted would roll this row back, and the
 * message would be retried three times and then dead-lettered.
 */
async function isProcessed(messageId: string): Promise<boolean> {
  const rows = await db.select().from(processed).where(eq(processed.messageId, messageId));
  return rows.length === 1;
}

// ── fixtures ────────────────────────────────────────────────────────────────

function codePayload(tenantId: string, category: string, o: Partial<CreateCodePayload> = {}): CreateCodePayload {
  return {
    id: randomUUID(),
    tenantId,
    code: "moved_to_other_provider",
    label: "Moved to another provider",
    description: null,
    category,
    appliesTo: [],
    governance: "tenant",
    versionNumber: 1,
    active: true,
    ordinal: 0,
    ...o,
  };
}

async function seedCode(
  tenantId: string,
  category: string,
  o: Partial<CreateCodePayload> = {},
): Promise<CreateCodePayload> {
  const p = codePayload(tenantId, category, o);
  await deliver(COMMANDS.createOutcomeReasonCode, envelope(COMMANDS.createOutcomeReasonCode, tenantId, p));
  return p;
}

function outcomePayload(
  tenantId: string,
  o: Partial<RecordOutcomePayload> = {},
): RecordOutcomePayload {
  return {
    id: randomUUID(),
    tenantId,
    subjectType: "contact",
    subjectId: randomUUID(),
    outcomeRef: `call-${randomUUID().slice(0, 8)}`,
    outcomeType: "declined",
    reasonCodeId: null,
    productId: null,
    amountMinor: null,
    currency: null,
    followUpNextActionId: null,
    occurredAt: "2026-05-30T10:00:00.000Z",
    ...o,
  };
}

// ── teardown ────────────────────────────────────────────────────────────────

afterAll(async () => {
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        // interaction_outcomes first: it carries the FK onto outcome_reason_codes.
        await tx.delete(interactionOutcomes).where(eq(interactionOutcomes.tenantId, tenantId));
        await tx.delete(outcomeReasonCodes).where(eq(outcomeReasonCodes.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
  // Canonical rows live under the PLATFORM sentinel tenant and are visible to every
  // tenant, so they are cleaned by the categories this file minted, not by tenant.
  if (categories.size > 0) {
    await runWithTenant(PLATFORM_TENANT_ID, () =>
      db.transaction((tx) =>
        tx.delete(outcomeReasonCodes).where(and(
          eq(outcomeReasonCodes.tenantId, PLATFORM_TENANT_ID),
          inArray(outcomeReasonCodes.category, [...categories]),
        )),
      ),
    );
  }
  if (messageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...messageIds]));
  }
  await sqlClient.end();
});

// ══ wiring + the structural idempotency contract ════════════════════════════

describe("consumer wiring and the idempotency contract", () => {
  it("registers exactly one handler for each of the four G18 commands", () => {
    expect(registrationOrder).toEqual([
      COMMANDS.createOutcomeReasonCode,
      COMMANDS.updateOutcomeReasonCode,
      COMMANDS.deleteOutcomeReasonCode,
      COMMANDS.recordInteractionOutcome,
    ]);
    expect(handlers.size).toBe(4);
  });

  it("every db.transaction in consumer.ts opens with the markProcessed guard", () => {
    const src = readFileSync(
      resolvePath(__dirname, "../src/modules/outcomes/consumer.ts"),
      "utf8",
    ).split("\n");
    const opens = src
      .map((line, i) => ({ line: line.trim(), i }))
      .filter((l) => l.line.startsWith("await db.transaction(async (tx) => {"));
    expect(opens.length).toBe(4);
    for (const open of opens) {
      expect((src[open.i + 1] ?? "").trim(), `line ${open.i + 2} of consumer.ts`)
        .toBe("if (!(await markProcessed(tx, msg.messageId))) return;");
    }
  });
});

// ══ crm.outcome_reason_code.create ══════════════════════════════════════════

describe("createOutcomeReasonCode", () => {
  it("inserts the code and emits created + audit in the same transaction", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const p = await seedCode(tenantId, category, { appliesTo: ["declined"], ordinal: 3 });

    const row = only(await readCodes(tenantId, category), "reason code");
    expect(row.id).toBe(p.id);
    expect(row.code).toBe("moved_to_other_provider");
    expect(row.label).toBe("Moved to another provider");
    expect(row.category).toBe(category);
    expect(row.appliesTo).toEqual(["declined"]);
    expect(row.governance).toBe("tenant");
    expect(row.versionNumber).toBe(1);
    expect(row.active).toBe(true);
    expect(row.ordinal).toBe(3);
    expect(row.version).toBe(1);
    expect(row.createdBy).toBe(ACTOR);
    expect(row.deletedAt).toBeNull();

    const created = only(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeCreated), "created event");
    expect(created).toMatchObject({
      reasonCodeId: p.id,
      code: "moved_to_other_provider",
      category,
      appliesTo: ["declined"],
      versionNumber: 1,
      active: true,
      governance: "tenant",
    });
    expect(await auditEntries(tenantId)).toEqual(["create:success"]);
  });

  it("IDEMPOTENCY: a redelivery writes no second row and emits no second event", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const msg = envelope(COMMANDS.createOutcomeReasonCode, tenantId, codePayload(tenantId, category));

    await deliver(COMMANDS.createOutcomeReasonCode, msg);
    await deliver(COMMANDS.createOutcomeReasonCode, msg);

    expect(await readCodes(tenantId, category)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeCreated)).toHaveLength(1);
    expect(await auditEntries(tenantId)).toEqual(["create:success"]);
  });

  it("DUPLICATE BUSINESS KEY: a different message reusing (category, code, revision) is skipped and COMMITS", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const first = await seedCode(tenantId, category);

    // Same business key under a fresh messageId — an operator double-click the route's
    // read did not catch.
    const clash = envelope(
      COMMANDS.createOutcomeReasonCode,
      tenantId,
      codePayload(tenantId, category, { label: "Second attempt" }),
    );
    await deliver(COMMANDS.createOutcomeReasonCode, clash);

    const row = only(await readCodes(tenantId, category), "reason code");
    expect(row.id).toBe(first.id);
    expect(row.label).toBe("Moved to another provider");
    expect(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeCreated)).toHaveLength(1);
    expect(await auditEntries(tenantId)).toEqual(["create:duplicate", "create:success"]);
    // The skip must COMMIT: otherwise the queue retries a command that can never
    // succeed, three times, into the DLQ.
    expect(await isProcessed(clash.messageId)).toBe(true);
  });

  it("a second REVISION of the same code is a new row, so history keeps its wording", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    await seedCode(tenantId, category, { label: "Old wording" });
    await seedCode(tenantId, category, { versionNumber: 2, label: "New wording" });

    const rows = await readCodes(tenantId, category);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.versionNumber).sort()).toEqual([1, 2]);
    expect(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeCreated)).toHaveLength(2);
  });

  it("TENANT ISOLATION: the same code under another tenant is a separate row", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const category = freshCategory();
    await seedCode(owner, category, { label: "owner label" });
    await seedCode(stranger, category, { label: "stranger label" });

    expect(only(await readCodes(owner, category), "owner code").label).toBe("owner label");
    expect(only(await readCodes(stranger, category), "stranger code").label).toBe("stranger label");
  });
});

// ══ crm.outcome_reason_code.update ══════════════════════════════════════════

describe("updateOutcomeReasonCode", () => {
  function updateMsg(tenantId: string, p: UpdateCodePayload): CommandEnvelope<UpdateCodePayload> {
    return envelope(COMMANDS.updateOutcomeReasonCode, tenantId, p);
  }

  it("applies the patch, bumps the version and emits updated with the changed keys", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);

    await deliver(COMMANDS.updateOutcomeReasonCode, updateMsg(tenantId, {
      id: code.id,
      tenantId,
      label: "Switched provider",
      appliesTo: ["declined", "deferred"],
      version: 1,
    }));

    const row = only(await readCodes(tenantId, category), "reason code");
    expect(row.label).toBe("Switched provider");
    expect(row.appliesTo).toEqual(["declined", "deferred"]);
    expect(row.version).toBe(2);
    expect(row.updatedBy).toBe(ACTOR);

    const updated = only(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeUpdated), "updated event");
    expect(updated.reasonCodeId).toBe(code.id);
    expect(updated.changed).toEqual(["label", "appliesTo"]);
  });

  it("retiring a code sets active=false without deleting it", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);

    await deliver(COMMANDS.updateOutcomeReasonCode, updateMsg(tenantId, {
      id: code.id, tenantId, active: false, version: 1,
    }));

    const row = only(await readCodes(tenantId, category), "reason code");
    expect(row.active).toBe(false);
    expect(row.deletedAt).toBeNull();
  });

  it("OPTIMISTIC LOCK: a stale version never clobbers the newer write, and is audited not thrown", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);
    await deliver(COMMANDS.updateOutcomeReasonCode, updateMsg(tenantId, {
      id: code.id, tenantId, label: "First writer wins", version: 1,
    }));

    // A command minted against version 1 arrives late.
    const stale = updateMsg(tenantId, { id: code.id, tenantId, label: "Lost update", version: 1 });
    await deliver(COMMANDS.updateOutcomeReasonCode, stale);

    const row = only(await readCodes(tenantId, category), "reason code");
    expect(row.label).toBe("First writer wins");
    expect(row.version).toBe(2);
    expect(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeUpdated)).toHaveLength(1);
    expect(await auditEntries(tenantId)).toContain("update:version_conflict");
    expect(await isProcessed(stale.messageId)).toBe(true);
  });

  it("IDEMPOTENCY: a redelivered update bumps the version once, not twice", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);
    const msg = updateMsg(tenantId, { id: code.id, tenantId, ordinal: 9, version: 1 });

    await deliver(COMMANDS.updateOutcomeReasonCode, msg);
    await deliver(COMMANDS.updateOutcomeReasonCode, msg);

    const row = only(await readCodes(tenantId, category), "reason code");
    expect(row.ordinal).toBe(9);
    expect(row.version).toBe(2);
    expect(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeUpdated)).toHaveLength(1);
  });

  it("GOVERNANCE: a canonical code is not amended even if a command reaches the consumer", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    // Canonical rows belong to the PLATFORM sentinel tenant and are readable by all.
    const canonical = codePayload(PLATFORM_TENANT_ID, category, {
      governance: "canonical",
      label: "National code",
    });
    await deliver(
      COMMANDS.createOutcomeReasonCode,
      envelope(COMMANDS.createOutcomeReasonCode, PLATFORM_TENANT_ID, canonical),
    );

    const attempt = updateMsg(tenantId, {
      id: canonical.id, tenantId: PLATFORM_TENANT_ID, label: "Renamed by a tenant", version: 1,
    });
    await deliver(COMMANDS.updateOutcomeReasonCode, attempt);

    const row = only(await readCodes(PLATFORM_TENANT_ID, category), "canonical code");
    expect(row.label).toBe("National code");
    expect(row.version).toBe(1);
    expect(await eventsOfType(PLATFORM_TENANT_ID, EVENTS.outcomeReasonCodeUpdated)).toEqual([]);
    expect(await isProcessed(attempt.messageId)).toBe(true);
  });

  it("TENANT ISOLATION: tenant B cannot amend tenant A's code", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const category = freshCategory();
    const code = await seedCode(owner, category, { label: "owner label" });

    await deliver(COMMANDS.updateOutcomeReasonCode, updateMsg(stranger, {
      id: code.id, tenantId: stranger, label: "hijacked", version: 1,
    }));

    expect(only(await readCodes(owner, category), "owner code").label).toBe("owner label");
    expect(await eventsOfType(owner, EVENTS.outcomeReasonCodeUpdated)).toEqual([]);
  });
});

// ══ crm.outcome_reason_code.delete ══════════════════════════════════════════

describe("deleteOutcomeReasonCode", () => {
  it("soft-deletes, deactivates and emits deleted", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);

    await deliver(
      COMMANDS.deleteOutcomeReasonCode,
      envelope(COMMANDS.deleteOutcomeReasonCode, tenantId, { id: code.id, tenantId }),
    );

    const row = only(await readCodes(tenantId, category), "reason code");
    expect(row.deletedAt).not.toBeNull();
    expect(row.active).toBe(false);
    expect(row.version).toBe(2);
    expect(only(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeDeleted), "deleted event"))
      .toMatchObject({ reasonCodeId: code.id });
  });

  it("a second delete under a fresh messageId is audited as not_applicable, not repeated", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);
    const payload = { id: code.id, tenantId };
    await deliver(COMMANDS.deleteOutcomeReasonCode, envelope(COMMANDS.deleteOutcomeReasonCode, tenantId, payload));

    const second = envelope(COMMANDS.deleteOutcomeReasonCode, tenantId, payload);
    await deliver(COMMANDS.deleteOutcomeReasonCode, second);

    expect(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeDeleted)).toHaveLength(1);
    expect(await auditEntries(tenantId)).toContain("delete:not_applicable");
    expect(await isProcessed(second.messageId)).toBe(true);
  });

  it("IDEMPOTENCY: a redelivered delete is a complete no-op", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);
    const msg = envelope(COMMANDS.deleteOutcomeReasonCode, tenantId, { id: code.id, tenantId });

    await deliver(COMMANDS.deleteOutcomeReasonCode, msg);
    await deliver(COMMANDS.deleteOutcomeReasonCode, msg);

    expect(only(await readCodes(tenantId, category), "reason code").version).toBe(2);
    expect(await eventsOfType(tenantId, EVENTS.outcomeReasonCodeDeleted)).toHaveLength(1);
  });

  it("TENANT ISOLATION: tenant B cannot delete tenant A's code", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const category = freshCategory();
    const code = await seedCode(owner, category);

    await deliver(
      COMMANDS.deleteOutcomeReasonCode,
      envelope(COMMANDS.deleteOutcomeReasonCode, stranger, { id: code.id, tenantId: stranger }),
    );

    expect(only(await readCodes(owner, category), "owner code").deletedAt).toBeNull();
  });
});

// ══ crm.interaction_outcome.record ══════════════════════════════════════════

describe("recordInteractionOutcome", () => {
  it("declined: writes the outcome and emits recorded + audit in the same transaction", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category, { appliesTo: ["declined"] });
    const p = outcomePayload(tenantId, { reasonCodeId: code.id, subjectType: "deal" });

    await deliver(COMMANDS.recordInteractionOutcome, envelope(COMMANDS.recordInteractionOutcome, tenantId, p));

    const row = only(await readOutcomes(tenantId), "outcome");
    expect(row.id).toBe(p.id);
    expect(row.subjectType).toBe("deal");
    expect(row.subjectId).toBe(p.subjectId);
    expect(row.outcomeRef).toBe(p.outcomeRef);
    expect(row.outcomeType).toBe("declined");
    expect(row.reasonCodeId).toBe(code.id);
    expect(row.amountMinor).toBeNull();
    expect(row.currency).toBeNull();
    expect(row.occurredAt.toISOString()).toBe("2026-05-30T10:00:00.000Z");
    expect(row.createdBy).toBe(ACTOR);
    expect(row.version).toBe(1);

    const recorded = only(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded), "recorded event");
    expect(recorded).toMatchObject({
      outcomeId: p.id,
      tenantId,
      subjectType: "deal",
      subjectId: p.subjectId,
      outcomeRef: p.outcomeRef,
      outcomeType: "declined",
      reasonCode: "moved_to_other_provider",
      reasonCodeId: code.id,
      reasonCodeCategory: category,
      productId: null,
      amountMinor: null,
      currency: null,
      followUpNextActionId: null,
      // The propensity signal is on the event so no consumer has to guess it.
      propensitySignal: -1,
      occurredAt: "2026-05-30T10:00:00.000Z",
    });
    expect(await auditEntries(tenantId)).toEqual(["create:success", "record:success"]);
  });

  it("converted: carries the product, and the signal is +1", async () => {
    const tenantId = freshTenant();
    const productId = randomUUID();
    const p = outcomePayload(tenantId, {
      outcomeType: "converted",
      productId,
      amountMinor: "250000",
      currency: "INR",
    });

    await deliver(COMMANDS.recordInteractionOutcome, envelope(COMMANDS.recordInteractionOutcome, tenantId, p));

    const row = only(await readOutcomes(tenantId), "outcome");
    expect(row.outcomeType).toBe("converted");
    expect(row.productId).toBe(productId);
    expect(row.reasonCodeId).toBeNull();

    const recorded = only(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded), "recorded event");
    expect(recorded.propensitySignal).toBe(1);
    expect(recorded.productId).toBe(productId);
  });

  it("deferred: carries the follow-up next action, and the signal is 0", async () => {
    const tenantId = freshTenant();
    const followUp = randomUUID();
    const p = outcomePayload(tenantId, { outcomeType: "deferred", followUpNextActionId: followUp });

    await deliver(COMMANDS.recordInteractionOutcome, envelope(COMMANDS.recordInteractionOutcome, tenantId, p));

    const row = only(await readOutcomes(tenantId), "outcome");
    expect(row.outcomeType).toBe("deferred");
    expect(row.followUpNextActionId).toBe(followUp);
    expect(only(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded), "recorded event")
      .propensitySignal).toBe(0);
  });

  it("MONEY: an amount above 2^53 is stored as an exact bigint and leaves as a STRING", async () => {
    const tenantId = freshTenant();
    const p = outcomePayload(tenantId, {
      outcomeType: "converted",
      productId: randomUUID(),
      amountMinor: ABOVE_2_53.toString(),
      currency: "INR",
    });

    await deliver(COMMANDS.recordInteractionOutcome, envelope(COMMANDS.recordInteractionOutcome, tenantId, p));

    const row = only(await readOutcomes(tenantId), "outcome");
    expect(typeof row.amountMinor).toBe("bigint");
    expect(row.amountMinor).toBe(ABOVE_2_53);
    expect(row.currency).toBe("INR");
    // Proof the value is genuinely outside double range.
    expect(BigInt(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);
    // …and on the wire it is a decimal string, never a JSON number.
    const recorded = only(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded), "recorded event");
    expect(recorded.amountMinor).toBe("9007199254740993");
    expect(typeof recorded.amountMinor).toBe("string");
  });

  it("IDEMPOTENCY: a redelivery writes no second row and emits no second event", async () => {
    const tenantId = freshTenant();
    const msg = envelope(
      COMMANDS.recordInteractionOutcome,
      tenantId,
      outcomePayload(tenantId, { outcomeType: "converted", productId: randomUUID() }),
    );

    await deliver(COMMANDS.recordInteractionOutcome, msg);
    await deliver(COMMANDS.recordInteractionOutcome, msg);

    expect(await readOutcomes(tenantId)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded)).toHaveLength(1);
  });

  it("DUPLICATE BUSINESS KEY: the same outcomeRef on the same subject is skipped, never double-counted", async () => {
    const tenantId = freshTenant();
    const first = outcomePayload(tenantId, { outcomeType: "converted", productId: randomUUID() });
    await deliver(COMMANDS.recordInteractionOutcome, envelope(COMMANDS.recordInteractionOutcome, tenantId, first));

    // Fresh messageId, fresh outcome id, same (subjectType, subjectId, outcomeRef).
    const clash = envelope(COMMANDS.recordInteractionOutcome, tenantId, outcomePayload(tenantId, {
      subjectType: first.subjectType,
      subjectId: first.subjectId,
      outcomeRef: first.outcomeRef,
      outcomeType: "converted",
      productId: randomUUID(),
    }));
    await deliver(COMMANDS.recordInteractionOutcome, clash);

    expect(only(await readOutcomes(tenantId), "outcome").id).toBe(first.id);
    // One outcome, one propensity signal. A second event here would corrupt the model.
    expect(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded)).toHaveLength(1);
    expect(await auditEntries(tenantId)).toContain("record:duplicate");
    expect(await isProcessed(clash.messageId)).toBe(true);
  });

  it("the same outcomeRef on a DIFFERENT subject is a distinct outcome", async () => {
    const tenantId = freshTenant();
    const ref = "visit-2026-05-30";
    for (const subjectId of [randomUUID(), randomUUID()]) {
      await deliver(COMMANDS.recordInteractionOutcome, envelope(
        COMMANDS.recordInteractionOutcome,
        tenantId,
        outcomePayload(tenantId, { subjectId, outcomeRef: ref, outcomeType: "converted", productId: randomUUID() }),
      ));
    }
    expect(await readOutcomes(tenantId)).toHaveLength(2);
    expect(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded)).toHaveLength(2);
  });

  it("GOVERNANCE: a domain violation is audited and skipped — the CHECK constraint is never reached", async () => {
    const tenantId = freshTenant();
    // declined with no reason code: refused by validateOutcome before the INSERT, so
    // ck_interaction_outcomes_declined_reason never fires and the inbox row survives.
    const msg = envelope(
      COMMANDS.recordInteractionOutcome,
      tenantId,
      outcomePayload(tenantId, { outcomeType: "declined", reasonCodeId: null }),
    );
    await deliver(COMMANDS.recordInteractionOutcome, msg);

    expect(await readOutcomes(tenantId)).toEqual([]);
    expect(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded)).toEqual([]);
    expect(await auditEntries(tenantId)).toEqual(["record:invalid:OUTCOME_REASON_CODE_REQUIRED"]);
    expect(await isProcessed(msg.messageId)).toBe(true);
  });

  it("GOVERNANCE: a converted outcome with no product is refused the same way", async () => {
    const tenantId = freshTenant();
    await deliver(COMMANDS.recordInteractionOutcome, envelope(
      COMMANDS.recordInteractionOutcome,
      tenantId,
      outcomePayload(tenantId, { outcomeType: "converted", productId: null }),
    ));

    expect(await readOutcomes(tenantId)).toEqual([]);
    expect(await auditEntries(tenantId)).toEqual(["record:invalid:OUTCOME_PRODUCT_REQUIRED"]);
  });

  it("GOVERNANCE: a deferred outcome with no follow-up is refused the same way", async () => {
    const tenantId = freshTenant();
    await deliver(COMMANDS.recordInteractionOutcome, envelope(
      COMMANDS.recordInteractionOutcome,
      tenantId,
      outcomePayload(tenantId, { outcomeType: "deferred", followUpNextActionId: null }),
    ));

    expect(await readOutcomes(tenantId)).toEqual([]);
    expect(await auditEntries(tenantId)).toEqual(["record:invalid:OUTCOME_FOLLOW_UP_REQUIRED"]);
  });

  it("a code RETIRED between the route accepting and the command landing is refused", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const code = await seedCode(tenantId, category);
    await deliver(COMMANDS.updateOutcomeReasonCode, envelope(COMMANDS.updateOutcomeReasonCode, tenantId, {
      id: code.id, tenantId, active: false, version: 1,
    }));

    await deliver(COMMANDS.recordInteractionOutcome, envelope(
      COMMANDS.recordInteractionOutcome,
      tenantId,
      outcomePayload(tenantId, { reasonCodeId: code.id }),
    ));

    expect(await readOutcomes(tenantId)).toEqual([]);
    expect(await auditEntries(tenantId)).toContain("record:invalid:REASON_CODE_INACTIVE");
  });

  it("a code that no longer exists is audited as reason_code_not_found, not thrown", async () => {
    const tenantId = freshTenant();
    const msg = envelope(
      COMMANDS.recordInteractionOutcome,
      tenantId,
      outcomePayload(tenantId, { reasonCodeId: randomUUID() }),
    );
    await deliver(COMMANDS.recordInteractionOutcome, msg);

    expect(await readOutcomes(tenantId)).toEqual([]);
    expect(await auditEntries(tenantId)).toEqual(["record:reason_code_not_found"]);
    expect(await isProcessed(msg.messageId)).toBe(true);
  });

  it("TENANT ISOLATION: tenant B cannot use tenant A's reason code", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const category = freshCategory();
    const code = await seedCode(owner, category);

    await deliver(COMMANDS.recordInteractionOutcome, envelope(
      COMMANDS.recordInteractionOutcome,
      stranger,
      outcomePayload(stranger, { reasonCodeId: code.id }),
    ));

    expect(await readOutcomes(stranger)).toEqual([]);
    expect(await auditEntries(stranger)).toEqual(["record:reason_code_not_found"]);
  });

  it("TENANT ISOLATION: an identical outcome under another tenant is a separate row", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const shared = { subjectId: randomUUID(), outcomeRef: "call-shared-ref", productId: randomUUID() };

    for (const tenantId of [owner, stranger]) {
      await deliver(COMMANDS.recordInteractionOutcome, envelope(
        COMMANDS.recordInteractionOutcome,
        tenantId,
        outcomePayload(tenantId, { ...shared, outcomeType: "converted" }),
      ));
    }

    expect(await readOutcomes(owner)).toHaveLength(1);
    expect(await readOutcomes(stranger)).toHaveLength(1);
    expect(only(await readOutcomes(owner), "owner outcome").id)
      .not.toBe(only(await readOutcomes(stranger), "stranger outcome").id);
  });

  it("a CANONICAL code is usable by any tenant — that is the point of canonical", async () => {
    const tenantId = freshTenant();
    const category = freshCategory();
    const canonical = codePayload(PLATFORM_TENANT_ID, category, {
      governance: "canonical",
      appliesTo: ["declined"],
    });
    await deliver(
      COMMANDS.createOutcomeReasonCode,
      envelope(COMMANDS.createOutcomeReasonCode, PLATFORM_TENANT_ID, canonical),
    );

    await deliver(COMMANDS.recordInteractionOutcome, envelope(
      COMMANDS.recordInteractionOutcome,
      tenantId,
      outcomePayload(tenantId, { reasonCodeId: canonical.id }),
    ));

    expect(only(await readOutcomes(tenantId), "outcome").reasonCodeId).toBe(canonical.id);
    expect(only(await eventsOfType(tenantId, EVENTS.interactionOutcomeRecorded), "recorded event")
      .reasonCode).toBe("moved_to_other_provider");
  });
});
