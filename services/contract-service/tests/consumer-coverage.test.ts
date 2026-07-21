/**
 * Consumer coverage tests — exercises clause consumer and domain guards
 * to push overall line coverage above the 80% gate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { clauseLibrary } from "../src/modules/clauses/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerClauseConsumers } from "../src/modules/clauses/consumer.js";
import {
  validateBody, validateMergeFields, ClauseDomainError,
  MAX_BODY_LENGTH, MAX_MERGE_FIELDS,
} from "../src/modules/clauses/domain.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR  = "00000000-cccc-4000-8000-000000000001";
const TENANT = "11111111-cccc-4000-8000-000000000001";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(clauseLibrary).where(eq(clauseLibrary.tenantId, TENANT));
  }));
}

const settle = () => new Promise<void>((r) => setTimeout(r, 400));

// ── Domain pure tests ──────────────────────────────────────────────────────

describe("Clause domain — validation guards (pure)", () => {
  it("validateBody passes for normal body", () => {
    expect(() => validateBody("Hello world")).not.toThrow();
  });

  it("validateBody rejects body exceeding MAX_BODY_LENGTH", () => {
    const longBody = "x".repeat(MAX_BODY_LENGTH + 1);
    expect(() => validateBody(longBody)).toThrowError(/must not exceed/);
  });

  it("validateMergeFields passes for valid array", () => {
    expect(() => validateMergeFields(["field1", "field2"])).not.toThrow();
  });

  it("validateMergeFields rejects non-array", () => {
    expect(() => validateMergeFields("not-an-array")).toThrowError(/must be an array/);
  });

  it("validateMergeFields rejects too many fields", () => {
    const fields = Array.from({ length: MAX_MERGE_FIELDS + 1 }, (_, i) => `f${i}`);
    expect(() => validateMergeFields(fields)).toThrowError(/must not exceed/);
  });

  it("validateMergeFields rejects empty string entries", () => {
    expect(() => validateMergeFields(["valid", ""])).toThrowError(/must be a non-empty string/);
  });

  it("validateMergeFields rejects non-string entries", () => {
    expect(() => validateMergeFields(["valid", 123])).toThrowError(/must be a non-empty string/);
  });

  it("ClauseDomainError has correct code and name", () => {
    const err = new ClauseDomainError("TEST_CODE", "test msg");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("ClauseDomainError");
    expect(err.message).toBe("test msg");
  });
});

// ── Clause consumer integration ────────────────────────────────────────────

describe("Clause consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  const CLAUSE_ID = randomUUID();
  const MSG_CREATE = randomUUID();
  const MSG_UPDATE = randomUUID();
  const MSG_ARCHIVE = randomUUID();

  it("clause.create inserts clause row and emits clause.created + audit", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerClauseConsumers(q);
    await q.start();

    await q.publish(COMMANDS.clauseCreate, {
      messageId: MSG_CREATE,
      type: COMMANDS.clauseCreate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-clause-create",
      schemaVersion: "1.0",
      payload: {
        id: CLAUSE_ID,
        title: "Force Majeure Clause",
        category: "general",
        jurisdiction: "India",
        body: "In the event of force majeure, obligations are suspended.",
        mergeFields: ["party_name", "effective_date"],
      },
    });

    await settle();
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(clauseLibrary).where(eq(clauseLibrary.id, CLAUSE_ID)),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Force Majeure Clause");
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.category).toBe("general");

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    ));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.clauseCreated);
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });

  it("clause.update modifies clause and bumps version", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerClauseConsumers(q);
    await q.start();

    await q.publish(COMMANDS.clauseUpdate, {
      messageId: MSG_UPDATE,
      type: COMMANDS.clauseUpdate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-clause-update",
      schemaVersion: "1.0",
      payload: {
        id: CLAUSE_ID,
        version: 1,
        title: "Updated Force Majeure Clause",
        body: "Updated body text for force majeure.",
        mergeFields: ["party_name", "effective_date", "duration"],
      },
    });

    await settle();
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(clauseLibrary).where(eq(clauseLibrary.id, CLAUSE_ID)),
    ));
    expect(rows[0]?.title).toBe("Updated Force Majeure Clause");
    expect(rows[0]?.version).toBe(2);
  });

  it("clause.archive sets status to archived", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerClauseConsumers(q);
    await q.start();

    await q.publish(COMMANDS.clauseArchive, {
      messageId: MSG_ARCHIVE,
      type: COMMANDS.clauseArchive,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-clause-archive",
      schemaVersion: "1.0",
      payload: { id: CLAUSE_ID, version: 2 },
    });

    await settle();
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(clauseLibrary).where(eq(clauseLibrary.id, CLAUSE_ID)),
    ));
    expect(rows[0]?.status).toBe("archived");
    expect(rows[0]?.version).toBe(3);
  });

  it("idempotency: redelivering clause.create is a no-op", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerClauseConsumers(q);
    await q.start();

    // Redeliver the same messageId
    await q.publish(COMMANDS.clauseCreate, {
      messageId: MSG_CREATE,
      type: COMMANDS.clauseCreate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-clause-redeliver",
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        title: "Should Not Appear",
        category: "general",
        jurisdiction: "India",
        body: "Should not be inserted.",
        mergeFields: [],
      },
    });

    await settle();
    await q.stop();

    // Only one clause should exist for this tenant
    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(clauseLibrary).where(eq(clauseLibrary.tenantId, TENANT)),
    ));
    expect(rows).toHaveLength(1);
  });
});
