/**
 * Owner decision #3 (2026-10-26) — GAP-REVENUE-INSTALMENTS-03.
 *
 * An instalment plan defers a demand, so it needs a SECOND officer: create
 * records a PENDING plan (not active); a different officer approves it (-> active,
 * audited) or rejects it; the maker can never decide their own plan. Enforced
 * in the consumer (and pre-checked in the route).
 *
 * Consumer half DB-backed, no mocks; route half mocks only the repo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { instalmentPlans, instalments } from "../src/modules/arrears/schema.js";
import { dcbEntries, demands } from "../src/modules/assessment/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "ad030000-0000-4000-8000-00000000ad30";
const ASSESSEE = "ad030000-0000-4000-8000-0000000000ee";
const DEMAND = "ad030000-0000-4000-8000-0000000de111";
const MAKER = "ad030000-0000-4000-8000-00000000a000";
const CHECKER = "ad030000-0000-4000-8000-0000000c0ec0";
const HEAD = "ad030000-0000-4000-8000-0000000a0a0a";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
const msg = (type: string, actorId: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(instalments).where(eq(instalments.tenantId, TENANT));
    await tx.delete(instalmentPlans).where(eq(instalmentPlans.tenantId, TENANT));
    await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
    await tx.delete(demands).where(eq(demands.tenantId, TENANT));
  }));
}
async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(demands).values({
      id: DEMAND, tenantId: TENANT, assesseeId: ASSESSEE, assessmentId: randomUUID(), rateHeadId: HEAD, financialYear: "2025-2026",
      dueDate: "2025-06-30", principalMinor: 1_200_000n, netMinor: 1_200_000n, computeSnapshot: {}, createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(dcbEntries).values({
      id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, entryType: "demand",
      amountMinor: 1_200_000n, balanceMinor: 1_200_000n, referenceType: "demand", narration: "fixture", createdBy: MAKER,
    });
  }));
}
async function start() {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerArrearsConsumers(q);
  await q.start();
  return q;
}
async function createPlan(q: MemoryQueue) {
  await q.publish(COMMANDS.instalmentPlanCreate, msg(COMMANDS.instalmentPlanCreate, MAKER, { assesseeId: ASSESSEE, instalmentCount: 4, startDate: "2026-11-01" }));
  await q.drain();
  const [plan] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(instalmentPlans).where(eq(instalmentPlans.tenantId, TENANT))));
  return plan!;
}
const planRow = (id: string) => runWithTenant(TENANT, () => db.transaction(async (tx) =>
  (await tx.select().from(instalmentPlans).where(eq(instalmentPlans.id, id)))[0]!));
const audits = () => runWithTenant(TENANT, () => db.transaction((tx) =>
  tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, "audit.event.record")))));

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("instalment plan maker-checker (owner decision #3, real DB)", () => {
  it("create records a PENDING plan — not active — with its schedule", async () => {
    const q = await start();
    const plan = await createPlan(q);
    expect(plan.status).toBe("pending");
    expect(plan.createdBy).toBe(MAKER);
    expect(plan.checkerUserId).toBeNull();
    const lines = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(instalments).where(eq(instalments.planId, plan.id))));
    expect(lines).toHaveLength(4);
    await q.stop();
  });

  it("the maker cannot decide their own plan (separation of duties); it stays pending", async () => {
    const q = await start();
    const plan = await createPlan(q);
    await q.publish(COMMANDS.instalmentPlanDecide, msg(COMMANDS.instalmentPlanDecide, MAKER, { planId: plan.id, approve: true }));
    await q.drain();
    expect(q.dlq.length).toBeGreaterThan(0);
    expect((await planRow(plan.id)).status).toBe("pending");
    await q.stop();
  });

  it("a DIFFERENT officer approves: plan becomes active, checker recorded, decision audited, approval event emitted", async () => {
    const q = await start();
    const plan = await createPlan(q);
    await q.publish(COMMANDS.instalmentPlanDecide, msg(COMMANDS.instalmentPlanDecide, CHECKER, { planId: plan.id, approve: true, reason: "hardship verified" }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    const row = await planRow(plan.id);
    expect(row.status).toBe("active");
    expect(row.checkerUserId).toBe(CHECKER);
    expect(row.decidedAt).toBeInstanceOf(Date);
    expect(row.decisionReason).toBe("hardship verified");
    const decide = (await audits()).map((a) => a.payload as Record<string, unknown>).find((p) => p.action === "decide");
    expect(decide).toMatchObject({ resourceType: "instalment_plan", outcome: "approved", resourceId: plan.id });
    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, EVENTS.instalmentPlanApproved)))));
    expect(events).toHaveLength(1);
    await q.stop();
  });

  it("a reject leaves the plan rejected (never active) and emits no approval event", async () => {
    const q = await start();
    const plan = await createPlan(q);
    await q.publish(COMMANDS.instalmentPlanDecide, msg(COMMANDS.instalmentPlanDecide, CHECKER, { planId: plan.id, approve: false, reason: "no basis" }));
    await q.drain();
    expect((await planRow(plan.id)).status).toBe("rejected");
    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, EVENTS.instalmentPlanApproved)))));
    expect(events).toHaveLength(0);
    await q.stop();
  });

  it("a second decide on an already-decided plan is a no-op", async () => {
    const q = await start();
    const plan = await createPlan(q);
    await q.publish(COMMANDS.instalmentPlanDecide, msg(COMMANDS.instalmentPlanDecide, CHECKER, { planId: plan.id, approve: true }));
    await q.drain();
    await q.publish(COMMANDS.instalmentPlanDecide, msg(COMMANDS.instalmentPlanDecide, CHECKER, { planId: plan.id, approve: false }));
    await q.drain();
    expect((await planRow(plan.id)).status).toBe("active");
    await q.stop();
  });
});

// ── Route half ───────────────────────────────────────────────────────────────
const R_TENANT = "f1111111-1111-4111-8111-111111111113";
const R_MAKER = "f2222222-2222-4222-8222-222222222223";
const R_OTHER = "f3333333-3333-4333-8333-333333333333";
const PENDING = "f4444444-4444-4444-8444-444444444443";
const DECIDED = "f5555555-5555-4555-8555-555555555553";
const SECRET = "test_secret_for_civitasone_32chr";
const tok = (sub: string, roles = ["revenue_admin"]) => ({ authorization: `Bearer ${signToken({ sub, tid: R_TENANT, roles, sid: "s1" }, SECRET, 3600)}` });
const publishSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/modules/arrears/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/arrears/repo.js")>();
  const plans: Record<string, Record<string, unknown>> = {
    "f4444444-4444-4444-8444-444444444443": { id: "f4444444-4444-4444-8444-444444444443", tenantId: "f1111111-1111-4111-8111-111111111113", status: "pending", createdBy: "f2222222-2222-4222-8222-222222222223", schedule: [] },
    "f5555555-5555-4555-8555-555555555553": { id: "f5555555-5555-4555-8555-555555555553", tenantId: "f1111111-1111-4111-8111-111111111113", status: "active", createdBy: "f2222222-2222-4222-8222-222222222223", schedule: [] },
  };
  return {
    ...original,
    findInstalmentPlanById: vi.fn(async (t: string, id: string) => (plans[id] && plans[id]!.tenantId === t ? plans[id]! : null)),
    listInstalmentPlansByStatus: vi.fn(async (t: string, opts: { status?: string }) => {
      const rows = Object.values(plans).filter((p) => p.tenantId === t && (!opts.status || p.status === opts.status));
      return { rows, total: rows.length };
    }),
  };
});
vi.mock("../src/shared/infra.js", () => ({
  cache: { put: vi.fn(), get: vi.fn().mockResolvedValue(null), getOrLoad: vi.fn().mockResolvedValue([]), invalidate: vi.fn() },
  queue: {
    publish: (...a: unknown[]) => publishSpy(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

describe("instalment plan decide routes (owner decision #3)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  const decide = (id: string, headers: Record<string, string>, payload: Record<string, unknown> = { approve: true }) =>
    app.inject({ method: "PATCH", url: `/v1/revenue/instalments/${id}/decide`, headers, payload });

  it("409 MAKER_CHECKER_VIOLATION when the maker decides, nothing published", async () => {
    publishSpy.mockClear();
    const res = await decide(PENDING, tok(R_MAKER));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MAKER_CHECKER_VIOLATION");
    expect(publishSpy).not.toHaveBeenCalled();
  });
  it("202 when a different officer decides a pending plan", async () => {
    const res = await decide(PENDING, tok(R_OTHER));
    expect(res.statusCode).toBe(202);
  });
  it("409 INSTALMENT_NOT_PENDING for an already-decided plan; 404 unknown; 400 bad body; 401/403 authz", async () => {
    expect((await decide(DECIDED, tok(R_OTHER))).json().error.code).toBe("INSTALMENT_NOT_PENDING");
    expect((await decide("f9999999-9999-4999-8999-999999999999", tok(R_OTHER))).statusCode).toBe(404);
    expect((await decide(PENDING, tok(R_OTHER), { nope: 1 })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/revenue/instalments/${PENDING}/decide`, payload: { approve: true } })).statusCode).toBe(401);
    expect((await decide(PENDING, tok(R_OTHER, ["employee"]))).statusCode).toBe(403);
  });
  it("GET /instalments?status=pending lists the checker queue; unknown status is 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/instalments?status=pending", headers: tok(R_OTHER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((p: { id: string }) => p.id)).toEqual([PENDING]);
    expect((await app.inject({ method: "GET", url: "/v1/revenue/instalments?status=bogus", headers: tok(R_OTHER) })).statusCode).toBe(400);
  });
});
