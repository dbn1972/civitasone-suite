/**
 * audit-service para state machine tests
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { auditParas, auditParaStatusHistory } from "../src/modules/para/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerParaConsumers } from "../src/modules/para/consumer.js";
import { registerComplianceConsumers } from "../src/modules/compliance/consumer.js";
import { assertCanTransition, assertBodyMutable, isValidTransition } from "../src/modules/para/domain.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import type { ParaStatus } from "../src/modules/para/schema.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000010";
const TENANT = "11111111-aaaa-4000-8000-000000000010";
const PARA_1 = "22222222-bbbb-4000-8000-000000000010";
const MSG_1  = "44444444-dddd-4000-8000-000000000010";
const MSG_2  = "44444444-dddd-4000-8000-000000000011";
const MSG_3  = "44444444-dddd-4000-8000-000000000012";
const MSG_4  = "44444444-dddd-4000-8000-000000000013";

async function wipe() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(auditParaStatusHistory).where(eq(auditParaStatusHistory.tenantId, TENANT));
  await db.delete(auditParas).where(eq(auditParas.tenantId, TENANT));
  for (const id of [MSG_1, MSG_2, MSG_3, MSG_4]) {
    await db.delete(processed).where(eq(processed.messageId, id));
  }
}

async function seedDraftPara(): Promise<void> {
  await db.insert(auditParas).values({
    id: PARA_1, tenantId: TENANT, paraNo: "PARA-2026-001", deptRef: "dept:finance",
    body: "Irregular payment detected", category: "financial", amountInvolvedMinor: 500000n,
    status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
  });
}

describe("Para domain — state machine (pure)", () => {
  it("draft → issued is valid", () => {
    expect(isValidTransition("draft", "issued")).toBe(true);
    expect(() => assertCanTransition("draft", "issued")).not.toThrow();
  });

  it("issued → replied is valid", () => {
    expect(() => assertCanTransition("issued", "replied")).not.toThrow();
  });

  it("replied → settled is valid", () => {
    expect(() => assertCanTransition("replied", "settled")).not.toThrow();
  });

  it("draft → settled is invalid", () => {
    expect(() => assertCanTransition("draft", "settled")).toThrowError("INVALID_TRANSITION");
  });

  it("issued → settled is invalid", () => {
    expect(() => assertCanTransition("issued", "settled")).toThrowError("INVALID_TRANSITION");
  });

  it("body is mutable only in draft", () => {
    expect(() => assertBodyMutable("draft")).not.toThrow();
    expect(() => assertBodyMutable("issued")).toThrowError("BODY_IMMUTABLE");
    expect(() => assertBodyMutable("replied")).toThrowError("BODY_IMMUTABLE");
  });
});

describe("Para consumer — CQRS state machine (integration)", () => {
  beforeAll(async () => { await wipe(); await seedDraftPara(); });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("draft → issued → replied → settled via queue consumers", async () => {
    const q = new MemoryQueue();
    registerParaConsumers(q);
    registerComplianceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.paraIssue, {
      messageId: MSG_1, type: COMMANDS.paraIssue,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-para-1", schemaVersion: "1.0",
      payload: { paraId: PARA_1, tenantId: TENANT },
    });
    await new Promise<void>((r) => setTimeout(r, 300));

    let rows = await db.select().from(auditParas).where(eq(auditParas.id, PARA_1));
    expect(rows[0]?.status).toBe("issued");

    await q.publish(COMMANDS.paraDeptResponse, {
      messageId: MSG_2, type: COMMANDS.paraDeptResponse,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-para-2", schemaVersion: "1.0",
      payload: {
        paraId: PARA_1, tenantId: TENANT,
        responseBody: "Recovery action initiated", respondedByRef: "dept:finance:head",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));

    rows = await db.select().from(auditParas).where(eq(auditParas.id, PARA_1));
    expect(rows[0]?.status).toBe("replied");

    await q.publish(COMMANDS.paraSettle, {
      messageId: MSG_3, type: COMMANDS.paraSettle,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-para-3", schemaVersion: "1.0",
      payload: { paraId: PARA_1, tenantId: TENANT, reason: "amount recovered" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    rows = await db.select().from(auditParas).where(eq(auditParas.id, PARA_1));
    expect(rows[0]?.status).toBe("settled");

    const history = await db.select().from(auditParaStatusHistory).where(eq(auditParaStatusHistory.paraId, PARA_1));
    const transitions = history.map((h) => `${h.fromStatus}→${h.toStatus}`);
    expect(transitions).toContain("draft→issued");
    expect(transitions).toContain("issued→replied");
    expect(transitions).toContain("replied→settled");

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.paraIssued);
  });

  it("consumer rejects body update when status is issued", async () => {
    await wipe();
    await db.insert(auditParas).values({
      id: PARA_1, tenantId: TENANT, paraNo: "PARA-2026-002", deptRef: "dept:hr",
      body: "Original para body", category: "compliance", amountInvolvedMinor: 0n,
      status: "issued", issuedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    });

    const q = new MemoryQueue();
    registerParaConsumers(q);
    await q.start();

    await q.publish(COMMANDS.paraDeptResponse, {
      messageId: MSG_4, type: COMMANDS.paraDeptResponse,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-para-4", schemaVersion: "1.0",
      payload: {
        paraId: PARA_1, tenantId: TENANT, body: "tampered body",
        responseBody: "Dept reply", respondedByRef: "dept:hr:head",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    const rows = await db.select().from(auditParas).where(eq(auditParas.id, PARA_1));
    expect(rows[0]?.body).toBe("Original para body");
    expect(rows[0]?.status).toBe("issued");
  });
});

describe("Para domain — full transition path", () => {
  const path: Array<[ParaStatus, ParaStatus]> = [
    ["draft", "issued"],
    ["issued", "replied"],
    ["replied", "settled"],
  ];

  it.each(path)("allows %s → %s", (from, to) => {
    expect(() => assertCanTransition(from, to)).not.toThrow();
  });
});
