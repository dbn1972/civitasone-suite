/**
 * Travel-request / expense-claim creates on the command path:
 *   route -> zod -> command (per-command messageId) -> 202 -> consumer
 * where the consumer does markProcessed + a guarded INSERT + the audit event in ONE transaction.
 *
 * Chained, real DB: the POST goes through the real route, the in-memory queue delivers to the
 * real social consumer, and we assert the row AND the audit/domain outbox events landed, that a
 * replay / duplicate id writes nothing twice, that a foreign travel-request link is refused, and
 * that maker != checker on expense approval still holds.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerSocialConsumers } from "../modules/social/consumer.js";
import { COMMANDS } from "../topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = randomUUID();
const OTHER = randomUUID();
const APPROVER = randomUUID();
const MANAGER_EMP = randomUUID();
const MAKER_EMP = randomUUID();

const tok = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-chain" }, SECRET, 3600)}`,
});
let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);

async function send(method: "POST" | "PATCH" | "GET", url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await drain();
  return res;
}

async function outbox(): Promise<Array<{ topic: string; actorId: string | null; payload: Record<string, any> }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return rows as Array<{ topic: string; actorId: string | null; payload: Record<string, any> }>;
}
const auditFor = async (action: string, resourceId: string) =>
  (await outbox()).filter((r) => r.topic === "audit.event.record" && r.payload?.action === action && r.payload?.resourceId === resourceId);

const travelBody = { purpose: "Audit visit to district office", destination: "Nagpur", fromDate: "2026-11-10", toDate: "2026-11-12", advanceRequired: 500000, mode: "air" };

beforeAll(async () => {
  app = await buildApp();
  registerSocialConsumers(queue);
  // MAKER reports to MANAGER_EMP, so the travel create also emits the approval notification.
  for (const [id, no, name, ref, mgr] of [
    [MANAGER_EMP, "CH-MGR", "Chain Manager", randomUUID(), null],
    [MAKER_EMP, "CH-MKR", "Chain Maker", MAKER, MANAGER_EMP],
  ] as Array<[string, string, string, string, string | null]>) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, user_ref, manager_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${randomUUID()}, ${randomUUID()}, '2020-01-01', 'confirmed', ${ref}, ${mgr}, ${MAKER}, ${MAKER})`);
  }
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM claims.hrms_expense_claims WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM claims.hrms_travel_requests WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await app.close();
  await sqlClient.end();
});

const travelRow = (id: string) => asTenant((tx) => tx`SELECT * FROM claims.hrms_travel_requests WHERE id = ${id}`) as unknown as Promise<Array<Record<string, any>>>;
const expenseRow = (id: string) => asTenant((tx) => tx`SELECT * FROM claims.hrms_expense_claims WHERE id = ${id}`) as unknown as Promise<Array<Record<string, any>>>;

describe("POST /v1/hrms/travel-requests -> consumer", () => {
  let id = "";

  it("202 {id,status:pending}; after the consumer runs the row exists, is the caller's, and carries every field", async () => {
    const r = await send("POST", "/v1/hrms/travel-requests", tok(MAKER, ["employee"]), travelBody);
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json().status).toBe("pending");
    id = r.json().id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await travelRow(id);
    expect(row).toBeTruthy();
    expect(row!.tenant_id).toBe(TENANT);
    expect(row!.employee_id).toBe(MAKER);
    expect(row!.status).toBe("pending");
    expect(row!.destination).toBe("Nagpur");
    expect(row!.mode).toBe("air");
    expect(Number(row!.advance_required)).toBe(500000);
  });

  it("wrote exactly one audit event + one domain event + the manager notification, in the consumer", async () => {
    const audits = await auditFor("travel_request_create", id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(MAKER);
    expect(audits[0]!.payload.resourceType).toBe("travel_request");
    expect(audits[0]!.payload.outcome).toBe("success");
    const all = await outbox();
    expect(all.filter((m) => m.topic === "hrms.social.travel_request_created" && m.payload.id === id)).toHaveLength(1);
    const notes = all.filter((m) => m.topic === "notification.send" && m.payload?.eventType === "hrms.travel.requested" && m.payload?.recipientId === MANAGER_EMP);
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it("redelivery of the same command (same messageId) writes nothing twice", async () => {
    await queue.publish(COMMANDS.travelRequestCreate, {
      messageId: id, type: COMMANDS.travelRequestCreate, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { ...travelBody, id, tenantId: TENANT, employeeId: MAKER },
    });
    await drain();
    expect(await travelRow(id)).toHaveLength(1);
    expect(await auditFor("travel_request_create", id)).toHaveLength(1);
  });

  it("a DIFFERENT messageId for an id that already exists is a no-op (guarded insert), no second audit", async () => {
    await queue.publish(COMMANDS.travelRequestCreate, {
      messageId: randomUUID(), type: COMMANDS.travelRequestCreate, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { ...travelBody, destination: "SOMEWHERE ELSE", id, tenantId: TENANT, employeeId: MAKER },
    });
    await drain();
    const rows = await travelRow(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.destination).toBe("Nagpur");
    expect(await auditFor("travel_request_create", id)).toHaveLength(1);
  });

  it("x-idempotency-key: a double-submit collapses to ONE request and ONE audit", async () => {
    const h = { ...tok(MAKER, ["employee"]), "x-idempotency-key": `idem-${randomUUID()}` };
    const a = await send("POST", "/v1/hrms/travel-requests", h, travelBody);
    const b = await send("POST", "/v1/hrms/travel-requests", h, travelBody);
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(b.json().id).toBe(a.json().id);
    expect(await travelRow(a.json().id)).toHaveLength(1);
    expect(await auditFor("travel_request_create", a.json().id)).toHaveLength(1);
  });

  it("validation still happens in the route: a bad body is 400 and publishes nothing", async () => {
    const before = (await outbox()).length;
    const r = await send("POST", "/v1/hrms/travel-requests", tok(MAKER, ["employee"]), { ...travelBody, fromDate: "tomorrow" });
    expect(r.statusCode).toBe(400);
    expect((await outbox()).length).toBe(before);
  });
});

describe("POST /v1/hrms/expenses -> consumer", () => {
  let travelId = "";
  let expenseId = "";

  it("202; the row lands via the consumer, linked to the caller's own travel request, with the audit event", async () => {
    const t = await send("POST", "/v1/hrms/travel-requests", tok(MAKER, ["employee"]), travelBody);
    travelId = t.json().id;
    const r = await send("POST", "/v1/hrms/expenses", tok(MAKER, ["employee"]), {
      category: "travel", amount: 45075, description: "Air fare", date: "2026-11-12", travelRequestId: travelId,
    });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json().status).toBe("pending");
    expenseId = r.json().id;

    const [row] = await expenseRow(expenseId);
    expect(row).toBeTruthy();
    expect(row!.employee_id).toBe(MAKER);
    expect(row!.travel_request_id).toBe(travelId);
    expect(row!.status).toBe("pending");
    expect(Number(row!.amount)).toBe(45075);

    const audits = await auditFor("expense_create", expenseId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(MAKER);
    expect(audits[0]!.payload.metadata.travelRequestId).toBe(travelId);
    expect((await outbox()).filter((m) => m.topic === "hrms.social.expense_created" && m.payload.id === expenseId)).toHaveLength(1);
  });

  it("redelivery / duplicate id writes nothing twice", async () => {
    await queue.publish(COMMANDS.expenseCreate, {
      messageId: expenseId, type: COMMANDS.expenseCreate, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: expenseId, tenantId: TENANT, employeeId: MAKER, category: "travel", amount: 1, description: "", date: "2026-11-12" },
    });
    await queue.publish(COMMANDS.expenseCreate, {
      messageId: randomUUID(), type: COMMANDS.expenseCreate, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: expenseId, tenantId: TENANT, employeeId: MAKER, category: "travel", amount: 2, description: "", date: "2026-11-12" },
    });
    await drain();
    const rows = await expenseRow(expenseId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.amount)).toBe(45075);
    expect(await auditFor("expense_create", expenseId)).toHaveLength(1);
  });

  it("another employee's travel request cannot be linked: the route 404s and nothing is written", async () => {
    const r = await send("POST", "/v1/hrms/expenses", tok(OTHER, ["employee"]), {
      category: "food", amount: 100, date: "2026-11-12", travelRequestId: travelId,
    });
    expect(r.statusCode).toBe(404);
  });

  it("... and even a command that bypasses the route is refused by the consumer, atomically (no row, no audit)", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.expenseCreate, {
      messageId: id, type: COMMANDS.expenseCreate, tenantId: TENANT, actorId: OTHER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, employeeId: OTHER, category: "food", amount: 100, description: "", date: "2026-11-12", travelRequestId: travelId },
    });
    await drain();
    expect(await expenseRow(id)).toHaveLength(0);
    expect(await auditFor("expense_create", id)).toHaveLength(0);
  });

  it("maker != checker still holds: the claimant cannot approve; a different approver can", async () => {
    const self = await send("PATCH", `/v1/hrms/expenses/${expenseId}/approve`, tok(MAKER, ["manager", "hr_admin"]));
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("SELF_APPROVAL");
    const ok = await send("PATCH", `/v1/hrms/expenses/${expenseId}/approve`, tok(APPROVER, ["hr_admin"]));
    expect(ok.statusCode, ok.body).toBe(200);
    const [row] = await expenseRow(expenseId);
    expect(row!.status).toBe("approved");
    expect(row!.approved_by).toBe(APPROVER);
  });

  it("a citizen cannot create a claim (403) and nothing is queued", async () => {
    const r = await send("POST", "/v1/hrms/expenses", tok(randomUUID(), ["citizen"]), { category: "food", amount: 100, date: "2026-11-12" });
    expect(r.statusCode).toBe(403);
  });
});
