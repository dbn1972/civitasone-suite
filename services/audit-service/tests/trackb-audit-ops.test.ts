/**
 * Track-B audit operations:
 *  - GAP-AUDIT-INVESTIGATION-05: GET /v1/audit/investigations/:id, PATCH .../assign, PATCH .../close
 *    (owner decision B4: audit_admin / audit_officer / vigilance_admin ONLY)
 *  - GAP-AUDIT-PLAN-05: PATCH /v1/audit/plans/:id/defer (reason required) and /complete
 *  - GAP-AUDIT-RISK-REGISTER-04: PATCH /v1/audit/risks/:id close requires a closeReason
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { investigations } from "../src/modules/investigation/schema.js";
import { auditPlans } from "../src/modules/plan/schema.js";
import { auditRisks } from "../src/modules/risk/schema.js";
import { registerInvestigationConsumers } from "../src/modules/investigation/consumer.js";
import { registerPlanConsumers } from "../src/modules/plan/consumer.js";
import { registerRiskConsumers } from "../src/modules/risk/consumer.js";
import { assertCanAssign, assertCanClose, DomainError } from "../src/modules/investigation/domain.js";
import { assertCanComplete, assertCanDefer } from "../src/modules/plan/domain.js";
import { updateRiskBody } from "../src/modules/risk/validators.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const token = (roles: string[], tenantId: string, actorId: string) =>
  signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const INV_OPEN = randomUUID();
const INV_CLOSED = randomUUID();
const PLAN_DRAFT = randomUUID();
const PLAN_ACTIVE = randomUUID();
const PLAN_DONE = randomUUID();
const RISK_1 = randomUUID();

const ALLOWED = ["audit_admin", "audit_officer", "vigilance_admin"];
const DENIED = ["tenant_admin", "super_admin", "vigilance_officer", "finance_admin", "employee"];

function tenantQueue(): Queue {
  const q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
const settle = (ms = 1200) => new Promise<void>((r) => setTimeout(r, ms));
const msg = (topic: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type: topic, tenantId: TENANT, actorId: ACTOR,
  correlationId: "corr-trackb", schemaVersion: "1.0", payload: { tenantId: TENANT, ...payload },
});
const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) => runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

let app: FastifyInstance;
const h = (roles: string[], tenant = TENANT) => ({ authorization: `Bearer ${token(roles, tenant, ACTOR)}`, "content-type": "application/json" });

beforeAll(async () => {
  app = await buildApp();
  await inTenant(async (tx) => {
    await tx.insert(investigations).values([
      { id: INV_OPEN, tenantId: TENANT, caseId: "CASE-T-1", subject: "Procurement irregularity", assignedTo: "officer:one", findings: "", status: "in_progress", createdBy: ACTOR, updatedBy: ACTOR },
      { id: INV_CLOSED, tenantId: TENANT, caseId: "CASE-T-2", subject: "Old case", assignedTo: "officer:one", findings: "x", status: "closed", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    const base = { tenantId: TENANT, title: "T", area: "Finance", periodFrom: "2026-04-01", periodTo: "2027-03-31", riskLevel: "medium", createdBy: ACTOR, updatedBy: ACTOR };
    await tx.insert(auditPlans).values([
      { ...base, id: PLAN_DRAFT, planNo: `P-${PLAN_DRAFT.slice(0, 8)}`, status: "draft" },
      { ...base, id: PLAN_ACTIVE, planNo: `P-${PLAN_ACTIVE.slice(0, 8)}`, status: "in_progress" },
      { ...base, id: PLAN_DONE, planNo: `P-${PLAN_DONE.slice(0, 8)}`, status: "completed" },
    ]);
    await tx.insert(auditRisks).values({ id: RISK_1, tenantId: TENANT, riskCode: "RC-T-1", title: "R", category: "financial", likelihood: "possible", impact: "moderate", riskScore: 9, status: "open", createdBy: ACTOR, updatedBy: ACTOR });
  });
});

afterAll(async () => {
  await inTenant((tx) => tx.delete(investigations).where(eq(investigations.tenantId, TENANT)));
  await app.close();
  await sqlClient.end();
});

describe("pure guards and validators", () => {
  it("investigation: closed is terminal", () => {
    expect(() => assertCanAssign("in_progress")).not.toThrow();
    expect(() => assertCanClose("findings_submitted")).not.toThrow();
    expect(() => assertCanAssign("closed")).toThrow(DomainError);
    expect(() => assertCanClose("closed")).toThrow(DomainError);
  });
  it("plan: defer from draft/in_progress, complete only from in_progress", () => {
    expect(() => assertCanDefer("draft")).not.toThrow();
    expect(() => assertCanDefer("in_progress")).not.toThrow();
    expect(() => assertCanDefer("completed")).toThrow();
    expect(() => assertCanComplete("in_progress")).not.toThrow();
    expect(() => assertCanComplete("draft")).toThrow();
    expect(() => assertCanComplete("deferred")).toThrow();
  });
  it("risk: closing needs a reason; a reason needs closing", () => {
    expect(updateRiskBody.safeParse({ status: "closed" }).success).toBe(false);
    expect(updateRiskBody.safeParse({ status: "closed", closeReason: "  " }).success).toBe(false);
    expect(updateRiskBody.safeParse({ status: "closed", closeReason: "Control now effective" }).success).toBe(true);
    expect(updateRiskBody.safeParse({ owner: "x", closeReason: "stray" }).success).toBe(false);
    expect(updateRiskBody.safeParse({ status: "open" }).success).toBe(true);
  });
});

describe("investigation routes (owner decision B4 role gate)", () => {
  it("401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/audit/investigations/${INV_OPEN}` })).statusCode).toBe(401);
  });
  it.each(DENIED)("403 for %s on list, detail, assign and close", async (role) => {
    expect((await app.inject({ method: "GET", url: "/v1/audit/investigations", headers: h([role]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/audit/investigations/${INV_OPEN}`, headers: h([role]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/audit/investigations/${INV_OPEN}/assign`, headers: h([role]), payload: { assignedTo: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/audit/investigations/${INV_OPEN}/close`, headers: h([role]), payload: { outcome: "inconclusive", reason: "no evidence" } })).statusCode).toBe(403);
  });
  it.each(ALLOWED)("200 detail for %s", async (role) => {
    const res = await app.inject({ method: "GET", url: `/v1/audit/investigations/${INV_OPEN}`, headers: h([role]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().caseId).toBe("CASE-T-1");
  });
  it("404 for an unknown id and for another tenant's case", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/audit/investigations/${randomUUID()}`, headers: h(["audit_admin"]) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/audit/investigations/${INV_OPEN}`, headers: h(["audit_admin"], OTHER) })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/v1/audit/investigations/${INV_OPEN}/assign`, headers: h(["audit_admin"], OTHER), payload: { assignedTo: "x" } })).statusCode).toBe(404);
  });
  it("assign: 400 empty assignee, 202 ok, 409 when closed", async () => {
    const url = (id: string) => `/v1/audit/investigations/${id}/assign`;
    expect((await app.inject({ method: "PATCH", url: url(INV_OPEN), headers: h(["audit_officer"]), payload: { assignedTo: " " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: url(INV_OPEN), headers: h(["audit_officer"]), payload: { assignedTo: "officer:two" } })).statusCode).toBe(202);
    const closed = await app.inject({ method: "PATCH", url: url(INV_CLOSED), headers: h(["audit_officer"]), payload: { assignedTo: "officer:two" } });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe("INVALID_STATUS");
  });
  it("close: 400 without reason or with a bad outcome, 202 ok, 409 when already closed", async () => {
    const url = (id: string) => `/v1/audit/investigations/${id}/close`;
    expect((await app.inject({ method: "PATCH", url: url(INV_OPEN), headers: h(["vigilance_admin"]), payload: { outcome: "substantiated" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: url(INV_OPEN), headers: h(["vigilance_admin"]), payload: { outcome: "bogus", reason: "because" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: url(INV_OPEN), headers: h(["vigilance_admin"]), payload: { outcome: "substantiated", reason: "evidence reviewed" } })).statusCode).toBe(202);
    expect((await app.inject({ method: "PATCH", url: url(INV_CLOSED), headers: h(["vigilance_admin"]), payload: { outcome: "substantiated", reason: "evidence reviewed" } })).statusCode).toBe(409);
  });
});

describe("plan defer/complete routes", () => {
  const defer = (id: string, roles: string[], payload: unknown) => app.inject({ method: "PATCH", url: `/v1/audit/plans/${id}/defer`, headers: h(roles), payload: payload as object });
  const complete = (id: string, roles: string[]) => app.inject({ method: "PATCH", url: `/v1/audit/plans/${id}/complete`, headers: h(roles), payload: {} });
  it("401/403", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/audit/plans/${PLAN_ACTIVE}/complete`, payload: {} })).statusCode).toBe(401);
    expect((await complete(PLAN_ACTIVE, ["employee"])).statusCode).toBe(403);
    expect((await defer(PLAN_ACTIVE, ["employee"], { reason: "budget" })).statusCode).toBe(403);
  });
  it("defer: 400 without a reason, 404 unknown, 409 completed, 202 draft", async () => {
    expect((await defer(PLAN_DRAFT, ["audit_officer"], {})).statusCode).toBe(400);
    expect((await defer(randomUUID(), ["audit_officer"], { reason: "budget freeze" })).statusCode).toBe(404);
    expect((await defer(PLAN_DONE, ["audit_officer"], { reason: "budget freeze" })).statusCode).toBe(409);
    expect((await defer(PLAN_DRAFT, ["audit_officer"], { reason: "budget freeze" })).statusCode).toBe(202);
  });
  it("complete: 409 for a draft, 404 unknown, 202 in_progress", async () => {
    expect((await complete(PLAN_DRAFT, ["audit_admin"])).statusCode).toBe(409);
    expect((await complete(randomUUID(), ["audit_admin"])).statusCode).toBe(404);
    expect((await complete(PLAN_ACTIVE, ["audit_admin"])).statusCode).toBe(202);
  });
});

describe("risk close-with-reason route", () => {
  const patch = (payload: unknown) => app.inject({ method: "PATCH", url: `/v1/audit/risks/${RISK_1}`, headers: h(["audit_officer"]), payload: payload as object });
  it("400 closing without a reason, 202 with one", async () => {
    expect((await patch({ status: "closed" })).statusCode).toBe(400);
    expect((await patch({ status: "closed", closeReason: "Mitigations verified" })).statusCode).toBe(202);
  });
});

describe("consumers persist state, reason and audit event", () => {
  it("investigation assign then close", async () => {
    const q = tenantQueue();
    registerInvestigationConsumers(q);
    await q.start();
    await q.publish(COMMANDS.investigationAssign, msg(COMMANDS.investigationAssign, { investigationId: INV_OPEN, assignedTo: "officer:two" }));
    await settle();
    let row = (await inTenant((tx) => tx.select().from(investigations).where(eq(investigations.id, INV_OPEN))))[0]!;
    expect(row.assignedTo).toBe("officer:two");
    expect(row.version).toBe(2);
    await q.publish(COMMANDS.investigationClose, msg(COMMANDS.investigationClose, { investigationId: INV_OPEN, outcome: "substantiated", reason: "evidence reviewed" }));
    await settle();
    row = (await inTenant((tx) => tx.select().from(investigations).where(eq(investigations.id, INV_OPEN))))[0]!;
    expect(row.status).toBe("closed");
    expect(row.closeOutcome).toBe("substantiated");
    expect(row.closeReason).toBe("evidence reviewed");
    expect(row.closedAt).toBeTruthy();
    // closed is terminal: a re-assign dead-letters and changes nothing
    await q.publish(COMMANDS.investigationAssign, msg(COMMANDS.investigationAssign, { investigationId: INV_OPEN, assignedTo: "officer:three" }));
    await settle(2000);
    await q.stop();
    row = (await inTenant((tx) => tx.select().from(investigations).where(eq(investigations.id, INV_OPEN))))[0]!;
    expect(row.assignedTo).toBe("officer:two");
  }, 15000);

  it("plan defer stores the reason; complete flips in_progress", async () => {
    const q = tenantQueue();
    registerPlanConsumers(q);
    await q.start();
    await q.publish(COMMANDS.planDefer, msg(COMMANDS.planDefer, { planId: PLAN_DRAFT, reason: "budget freeze" }));
    await q.publish(COMMANDS.planComplete, msg(COMMANDS.planComplete, { planId: PLAN_ACTIVE }));
    await settle();
    await q.stop();
    const d = (await inTenant((tx) => tx.select().from(auditPlans).where(eq(auditPlans.id, PLAN_DRAFT))))[0]!;
    expect(d.status).toBe("deferred");
    expect(d.deferReason).toBe("budget freeze");
    const c = (await inTenant((tx) => tx.select().from(auditPlans).where(eq(auditPlans.id, PLAN_ACTIVE))))[0]!;
    expect(c.status).toBe("completed");
  }, 15000);

  it("risk close stores the reason; re-open clears it", async () => {
    const q = tenantQueue();
    registerRiskConsumers(q);
    await q.start();
    await q.publish(COMMANDS.riskUpdate, msg(COMMANDS.riskUpdate, { riskId: RISK_1, status: "closed", closeReason: "Mitigations verified" }));
    await settle();
    let r = (await inTenant((tx) => tx.select().from(auditRisks).where(eq(auditRisks.id, RISK_1))))[0]!;
    expect(r.status).toBe("closed");
    expect(r.closeReason).toBe("Mitigations verified");
    await q.publish(COMMANDS.riskUpdate, msg(COMMANDS.riskUpdate, { riskId: RISK_1, status: "open" }));
    await settle();
    await q.stop();
    r = (await inTenant((tx) => tx.select().from(auditRisks).where(eq(auditRisks.id, RISK_1))))[0]!;
    expect(r.status).toBe("open");
    expect(r.closeReason).toBeNull();
  }, 15000);
});
