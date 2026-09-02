/**
 * audit-service compliance module tests
 *
 * Covers:
 *  - GET /v1/audit/compliance/pending, GET /v1/audit/compliance route auth (401/403/200)
 *  - checklist lifecycle (async command routes): POST accepts (202) -> drain -> row lands;
 *    GET reflects the row; PATCH complete accepts (202) -> drain -> row flips completed;
 *    PATCH again hits the route's synchronous already-completed pre-check (409)
 *  - checklist auth (401/403) and validation (400)
 *  - consumer integration: COMMANDS.pendingRegisterCreate -> auditPendingRegister row
 *  - runAgeingSweep: pending row past dueDate flips to overdue
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { auditPendingRegister, auditChecklists } from "../src/modules/compliance/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerComplianceConsumers } from "../src/modules/compliance/consumer.js";
import { runAgeingSweep } from "../src/modules/compliance/jobs.js";
import { COMMANDS } from "../src/topics.js";

// checklist-routes.ts publishes checklistCreate/checklistComplete onto the
// real `queue` singleton from shared/infra.js and answers 202 as soon as the
// command is queued (see checklist-routes.ts:34-87) — only worker.ts wires
// registerComplianceConsumers() onto that singleton in production, so this
// test file must subscribe it itself. Registered once at module scope
// (mirrors hrms-service/tests/agent1-gap-routes.test.ts's
// registerF3_employee_Consumers(queue) pattern) — MemoryQueue accumulates
// handlers, so re-registering per test would process every command twice.
registerComplianceConsumers(queue);

/** Await the async checklist write published by the route just injected. */
async function drainChecklist(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT = "33333333-aaaa-4000-8000-000000000020";
const ACTOR  = "33333333-bbbb-4000-8000-000000000021";
const PARA_1 = "33333333-cccc-4000-8000-000000000022";
const PARA_2 = "33333333-cccc-4000-8000-000000000023";
const OVERDUE_ROW = "33333333-dddd-4000-8000-000000000024";
const MSG_PENDING_CREATE = "33333333-eeee-4000-8000-000000000025";

/**
 * Test-harness fix: `new MemoryQueue()` used directly does NOT auto-wrap
 * subscribed handlers with `withTenantConsumer`. Production wiring
 * (queue-service's `createQueue()`) decorates `subscribe()` so every
 * consumer handler runs inside `runWithTenant(msg.tenantId, ...)`, which is
 * what lets `db.transaction()` pick up the tenant GUC. Mirrors para.test.ts.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;
let checklistId: string | undefined;

const officerToken = token(["audit_officer"], TENANT, ACTOR);
const adminToken = token(["audit_admin"], TENANT, ACTOR);
const financeAdminToken = token(["finance_admin"], TENANT, ACTOR);
const superAdminToken = token(["super_admin"], TENANT, ACTOR);
const employeeToken = token(["employee"], TENANT, ACTOR);

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(auditChecklists).where(eq(auditChecklists.tenantId, TENANT));
    await tx.delete(auditPendingRegister).where(eq(auditPendingRegister.tenantId, TENANT));
    await tx.delete(processed).where(eq(processed.messageId, MSG_PENDING_CREATE));
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("Compliance routes — auth", () => {
  it("GET /v1/audit/compliance/pending — 401 with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/compliance/pending" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/audit/compliance/pending — 403 for employee role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/audit/compliance/pending",
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ["audit_officer", officerToken],
    ["audit_admin", adminToken],
    ["finance_admin", financeAdminToken],
    ["super_admin", superAdminToken],
  ])("GET /v1/audit/compliance/pending — 200 for %s", async (_role, tok) => {
    const res = await app.inject({
      method: "GET", url: "/v1/audit/compliance/pending",
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it("GET /v1/audit/compliance — 401 with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/compliance" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/audit/compliance — 403 for employee role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/audit/compliance",
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ["audit_officer", officerToken],
    ["audit_admin", adminToken],
    ["finance_admin", financeAdminToken],
    ["super_admin", superAdminToken],
  ])("GET /v1/audit/compliance — 200 for %s", async (_role, tok) => {
    const res = await app.inject({
      method: "GET", url: "/v1/audit/compliance",
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    // sendValidated() sends the parsed AuditComplianceListSchema payload
    // directly (it's z.array(...)) — the response body IS the array, not
    // { data: [...] }.
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("Compliance checklists — auth", () => {
  it("POST /v1/audit/compliance/checklists — 401 with no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/audit/compliance/checklists",
      payload: { title: "x", items: ["a"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/audit/compliance/checklists — 403 for employee role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/audit/compliance/checklists",
      headers: { authorization: `Bearer ${employeeToken}`, "content-type": "application/json" },
      payload: { title: "x", items: ["a"] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/audit/compliance/checklists — 401 with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/compliance/checklists" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/audit/compliance/checklists — 403 for employee role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/audit/compliance/checklists",
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/audit/compliance/checklists/:id/complete — 401 with no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/audit/compliance/checklists/${crypto.randomUUID()}/complete`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /v1/audit/compliance/checklists/:id/complete — 403 for employee role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/audit/compliance/checklists/${crypto.randomUUID()}/complete`,
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Compliance checklists — validation", () => {
  it("POST with empty items array — 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/audit/compliance/checklists",
      headers: { authorization: `Bearer ${officerToken}`, "content-type": "application/json" },
      payload: { title: "Empty items checklist", items: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST with missing title — 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/audit/compliance/checklists",
      headers: { authorization: `Bearer ${officerToken}`, "content-type": "application/json" },
      payload: { items: ["a"] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Compliance checklists — lifecycle (async command routes)", () => {
  it("POST accepts (202) and, once the consumer drains, the row lands", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/audit/compliance/checklists",
      headers: { authorization: `Bearer ${officerToken}`, "content-type": "application/json" },
      payload: {
        title: "Quarterly compliance checklist",
        description: "Q1 review items",
        items: ["Verify PAN encryption", "Verify RLS on new tables", "Review pending register"],
      },
    });
    // checklist-routes.ts:34-56 replies 202 as soon as commands.createChecklist()
    // has queued the command — the row does not exist synchronously.
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data).toBeTruthy();
    expect(body.data.status).toBe("accepted");
    expect(body.data.completed).toBe(false);
    checklistId = body.data.id;
    expect(checklistId).toBeDefined();

    await drainChecklist();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(auditChecklists).where(eq(auditChecklists.id, checklistId!))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Quarterly compliance checklist");
    expect(rows[0]?.items).toHaveLength(3);
    expect(rows[0]?.completed).toBe(false);
  });

  it("GET lists checklists and includes the created one", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/audit/compliance/checklists",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    const found = body.data.find((c: { id?: string }) => c.id === checklistId);
    expect(found).toBeTruthy();
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("PATCH complete accepts (202) and, once the consumer drains, the row is completed", async () => {
    expect(checklistId).toBeDefined();
    const res = await app.inject({
      method: "PATCH", url: `/v1/audit/compliance/checklists/${checklistId}/complete`,
      headers: { authorization: `Bearer ${officerToken}` },
    });
    // checklist-routes.ts:69-87 replies 202 as soon as commands.completeChecklist()
    // has queued the command — completedBy/completedAt are only set once the
    // consumer applies the write (consumer.ts:47-70).
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");

    await drainChecklist();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(auditChecklists).where(eq(auditChecklists.id, checklistId!))));
    expect(rows[0]?.completed).toBe(true);
    expect(rows[0]?.completedBy).toBe(ACTOR);
    expect(rows[0]?.completedAt).toBeTruthy();
  });

  it("PATCH complete again on same id — 409 ALREADY_COMPLETED (synchronous pre-check)", async () => {
    // checklist-routes.ts:74-76 reads current state inside a transaction and
    // throws 409 synchronously *before* publishing another checklistComplete
    // command — this pre-check already exists and does not need a drain to
    // observe it, since the prior test's drain() left completed=true committed.
    const res = await app.inject({
      method: "PATCH", url: `/v1/audit/compliance/checklists/${checklistId}/complete`,
      headers: { authorization: `Bearer ${officerToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ALREADY_COMPLETED");
  });

  it("PATCH complete on unknown id — 404 NOT_FOUND", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/audit/compliance/checklists/${crypto.randomUUID()}/complete`,
      headers: { authorization: `Bearer ${officerToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("Compliance consumer — COMMANDS.pendingRegisterCreate", () => {
  it("inserts a row into auditPendingRegister with amountInvolvedMinor as BigInt", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerComplianceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.pendingRegisterCreate, {
      messageId: MSG_PENDING_CREATE, type: COMMANDS.pendingRegisterCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-pending-1", schemaVersion: "1.0",
      payload: {
        id: PARA_1, tenantId: TENANT, paraId: PARA_1, deptRef: "dept:finance",
        amountInvolvedMinor: "9007199254740993", // > 2^53, exercises string-carried bigint path
        dueDate: "2020-01-01",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(auditPendingRegister).where(eq(auditPendingRegister.id, PARA_1))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.deptRef).toBe("dept:finance");
    expect(typeof rows[0]?.amountInvolvedMinor).toBe("bigint");
    expect(rows[0]?.amountInvolvedMinor).toBe(9007199254740993n);
  });
});

describe("Compliance jobs — runAgeingSweep", () => {
  it("flips a pending row past its dueDate to overdue", async () => {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(auditPendingRegister).values({
      id: OVERDUE_ROW, tenantId: TENANT, paraId: PARA_2, deptRef: "dept:hr",
      amountInvolvedMinor: 100000n, status: "pending", dueDate: "2020-01-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    })));

    const count = await runAgeingSweep();
    expect(count).toBeGreaterThanOrEqual(1);

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(auditPendingRegister).where(eq(auditPendingRegister.id, OVERDUE_ROW))));
    expect(rows[0]?.status).toBe("overdue");
  });

  it("does not affect rows with a future dueDate", async () => {
    const futureId = "33333333-ffff-4000-8000-000000000026";
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(auditPendingRegister).values({
      id: futureId, tenantId: TENANT, paraId: PARA_2, deptRef: "dept:hr",
      amountInvolvedMinor: 100000n, status: "pending", dueDate: "2099-01-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    })));

    await runAgeingSweep();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(auditPendingRegister).where(eq(auditPendingRegister.id, futureId))));
    expect(rows[0]?.status).toBe("pending");

    await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.delete(auditPendingRegister).where(eq(auditPendingRegister.id, futureId))));
  });
});
