/**
 * audit-service observation module tests
 *
 * Covers:
 *   1. Pure domain tests — assertCanTransition / isClosable / assertCanDraftPara
 *   2. Route auth — 401 / 403 / 202 for POST /v1/audit/observations
 *   3. Consumer integration — create lands with status "open"
 *   4. Full lifecycle via consumer — open -> replied -> compliance_pending -> closed
 *   5. Idempotency — republished observationCreate messageId inserts exactly one row
 *   6. GET /v1/audit/observations/:id -> 404 for nonexistent id
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditObservations } from "../src/modules/observation/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerObservationConsumers } from "../src/modules/observation/consumer.js";
import { assertCanTransition, isClosable, assertCanDraftPara, DomainError } from "../src/modules/observation/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const ACTOR  = "00000000-aaaa-4000-8000-0000000000a1";
const TENANT = "11111111-aaaa-4000-8000-0000000000a1";
const OBS_1  = "22222222-bbbb-4000-8000-0000000000a1";
const OBS_2  = "22222222-bbbb-4000-8000-0000000000a2";
const OBS_3  = "22222222-bbbb-4000-8000-0000000000a3";
const MSG_1  = "44444444-dddd-4000-8000-0000000000a1";
const MSG_2  = "44444444-dddd-4000-8000-0000000000a2";
const MSG_3  = "44444444-dddd-4000-8000-0000000000a3";
const MSG_4  = "44444444-dddd-4000-8000-0000000000a4";
const MSG_5  = "44444444-dddd-4000-8000-0000000000a5";
const MSG_DUP = "44444444-dddd-4000-8000-0000000000a6";

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the `createQueue()`
 * factory) does NOT auto-wrap subscribed handlers with `withTenantConsumer`.
 * Production wiring (queue-service's `createQueue()`) decorates `subscribe()`
 * so every consumer handler runs inside `runWithTenant(msg.tenantId, ...)`,
 * which is what lets `db.transaction()` pick up the tenant GUC. Mirrors the
 * pattern in tests/para.test.ts.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const ALL_MSG_IDS = [MSG_1, MSG_2, MSG_3, MSG_4, MSG_5, MSG_DUP];

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(auditObservations).where(eq(auditObservations.tenantId, TENANT));
    for (const id of ALL_MSG_IDS) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  }));
}

describe("Observation domain — lifecycle state machine (pure)", () => {
  it("open -> replied is valid", () => {
    expect(() => assertCanTransition("open", "replied")).not.toThrow();
  });

  it("replied -> compliance_pending is valid", () => {
    expect(() => assertCanTransition("replied", "compliance_pending")).not.toThrow();
  });

  it("compliance_pending -> closed is valid", () => {
    expect(() => assertCanTransition("compliance_pending", "closed")).not.toThrow();
  });

  it("open -> closed is invalid (must go through replied/compliance_pending first)", () => {
    expect(() => assertCanTransition("open", "closed")).toThrowError(DomainError);
    expect(() => assertCanTransition("open", "closed")).toThrowError("INVALID_TRANSITION");
  });

  it("closed -> anything is invalid (terminal state)", () => {
    expect(() => assertCanTransition("closed", "open")).toThrowError("INVALID_TRANSITION");
    expect(() => assertCanTransition("closed", "replied")).toThrowError("INVALID_TRANSITION");
  });

  it("isClosable: closed is not closable (already terminal), compliance_pending is", () => {
    expect(isClosable("closed")).toBe(false);
    expect(isClosable("compliance_pending")).toBe(true);
  });

  it("isClosable: open is not directly closable", () => {
    expect(isClosable("open")).toBe(false);
  });

  it("assertCanDraftPara: open is ok", () => {
    expect(() => assertCanDraftPara("open")).not.toThrow();
  });

  it("assertCanDraftPara: replied throws INVALID_STATUS", () => {
    expect(() => assertCanDraftPara("replied")).toThrowError(DomainError);
    expect(() => assertCanDraftPara("replied")).toThrowError("INVALID_STATUS");
  });
});

describe("Observation routes — auth (inject)", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("POST /v1/audit/observations without token -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/observations",
      payload: { obsNo: "OBS-1", auditeeRef: "dept:finance", finding: "test finding", amountInvolvedMinor: "500000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/audit/observations with wrong role (employee) -> 403", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { obsNo: "OBS-1", auditeeRef: "dept:finance", finding: "test finding", amountInvolvedMinor: "500000" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/audit/observations with audit_officer + valid body -> 202", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { obsNo: "OBS-ROUTE-1", auditeeRef: "dept:finance", finding: "test finding", amountInvolvedMinor: "500000" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
  });

  it("GET /v1/audit/observations/:id -> 404 for nonexistent id", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/observations/${randomUUID()}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Observation consumer — create (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("publishing observationCreate lands a row with status 'open'", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerObservationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.observationCreate, {
      messageId: MSG_1, type: COMMANDS.observationCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-obs-1", schemaVersion: "1.0",
      payload: {
        id: OBS_1, tenantId: TENANT, obsNo: "OBS-2026-001", auditeeRef: "dept:finance",
        finding: "Irregular payment detected", category: "compliance", riskLevel: "medium",
        amountInvolvedMinor: "500000",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditObservations).where(eq(auditObservations.id, OBS_1))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("open");
    expect(rows[0]?.obsNo).toBe("OBS-2026-001");
    expect(rows[0]?.amountInvolvedMinor).toBe(500000n);
  });

  it("idempotency: republishing the same messageId inserts exactly one row", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerObservationConsumers(q);
    await q.start();

    const env = {
      messageId: MSG_DUP, type: COMMANDS.observationCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-obs-dup", schemaVersion: "1.0",
      payload: {
        id: OBS_2, tenantId: TENANT, obsNo: "OBS-2026-002", auditeeRef: "dept:hr",
        finding: "Duplicate delivery test", category: "compliance", riskLevel: "low",
        amountInvolvedMinor: "100",
      },
    };
    await q.publish(COMMANDS.observationCreate, env);
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.publish(COMMANDS.observationCreate, { ...env }); // redelivery, same messageId
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditObservations).where(eq(auditObservations.id, OBS_2))));
    expect(rows).toHaveLength(1);
  });
});

describe("Observation consumer — full lifecycle (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("open -> replied -> compliance_pending -> closed via queue consumers", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerObservationConsumers(q);
    await q.start();

    // 1. create -> open
    await q.publish(COMMANDS.observationCreate, {
      messageId: MSG_2, type: COMMANDS.observationCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-life-1", schemaVersion: "1.0",
      payload: {
        id: OBS_3, tenantId: TENANT, obsNo: "OBS-2026-LIFE", auditeeRef: "dept:finance",
        finding: "Lifecycle test finding", category: "compliance", riskLevel: "medium",
        amountInvolvedMinor: "750000",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));

    let rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditObservations).where(eq(auditObservations.id, OBS_3))));
    expect(rows[0]?.status).toBe("open");

    // 2. reply -> replied
    await q.publish(COMMANDS.observationReply, {
      messageId: MSG_3, type: COMMANDS.observationReply,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-life-2", schemaVersion: "1.0",
      payload: {
        id: randomUUID(), observationId: OBS_3, tenantId: TENANT,
        replyText: "Corrective action taken", respondedByRef: "dept:finance:head",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));

    rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditObservations).where(eq(auditObservations.id, OBS_3))));
    expect(rows[0]?.status).toBe("replied");

    // 3. review (accepted) -> compliance_pending
    await q.publish(COMMANDS.observationReview, {
      messageId: MSG_4, type: COMMANDS.observationReview,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-life-3", schemaVersion: "1.0",
      payload: { id: randomUUID(), observationId: OBS_3, tenantId: TENANT, decision: "accepted" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));

    rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditObservations).where(eq(auditObservations.id, OBS_3))));
    expect(rows[0]?.status).toBe("compliance_pending");

    // 4. close (mode full, no linked paras/pending-register rows -> no blockers) -> closed
    await q.publish(COMMANDS.observationClose, {
      messageId: MSG_5, type: COMMANDS.observationClose,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-life-4", schemaVersion: "1.0",
      payload: { id: randomUUID(), observationId: OBS_3, tenantId: TENANT, mode: "full", closureRemarks: "Fully resolved, no outstanding paras" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditObservations).where(eq(auditObservations.id, OBS_3))));
    expect(rows[0]?.status).toBe("closed");

    const outbox = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});
