/**
 * F3 manpower-planning consumer — unit tests.
 *
 * Same bug class as the leave fix documented in ../leave/f3-consumer.test.ts:
 * `manpower_planning_routes__4` (approve a plan) referenced `plan`, `vac` and
 * `AUDIT`, none of which the code-gen defined, so it threw a ReferenceError on
 * every invocation while POST /v1/hrms/manpower/plans/:id/approve had already
 * answered 200 "approved". The plan was never approved, no recruitment
 * requisition was generated, and no hrms.job.create was emitted — the
 * plan→requisition→job-opening chain was silently dead.
 *
 * The real ./domain.js is used (computeVacancy/allocateRoster are pure), so the
 * vacancy these tests assert is the one the engine actually produces. Driven
 * directly over a MemoryQueue because the F3 consumers are registered only in
 * worker.ts, never in app.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueueMock, R } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn(), select: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueueMock = vi.fn(async (..._a: any[]) => undefined);
  const _R = {
    insertPlan: vi.fn(async (..._a: any[]) => undefined),
    getPlanTx: vi.fn(async (..._a: any[]) => null as any),
    updateDraftPlan: vi.fn(async (..._a: any[]) => null),
    submitPlan: vi.fn(async (..._a: any[]) => null),
    approvePlan: vi.fn(async (..._a: any[]) => null as any),
    rejectPlan: vi.fn(async (..._a: any[]) => null),
    replaceRoster: vi.fn(async (..._a: any[]) => undefined),
    listRoster: vi.fn(async (..._a: any[]) => [] as any[]),
    insertRequisition: vi.fn(async (..._a: any[]) => undefined),
    markRequisitionAdvertised: vi.fn(async (..._a: any[]) => null),
  };
  return { mockTx: _mockTx, dbTransactionFn: _dbTransactionFn, enqueueMock: _enqueueMock, R: _R };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => enqueueMock(...(a as [])),
  markProcessed: vi.fn(async (..._a: any[]) => true),
}));
vi.mock("./repo.js", () => R);

import { registerF3_manpower_planning_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const PLAN = "30000000-cccc-4000-8000-000000000001";
const UNIT = "40000000-dddd-4000-8000-000000000001";
const DESIGNATION = "50000000-eeee-4000-8000-000000000001";
const REQUISITION = "60000000-ffff-4000-8000-000000000001";

const plan = (over: Record<string, unknown> = {}) => ({
  id: PLAN, tenantId: TENANT, planYear: 2028, unitId: UNIT, cadre: "Section Officer",
  designationId: DESIGNATION, requiredStrength: 10, sanctionedStrength: 9, filledStrength: 2,
  status: "pending_approval", createdBy: "someone-else", ...over,
});

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_manpower_planning_Consumers(q);
  await q.start();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  R.getPlanTx.mockResolvedValue(plan());
  R.approvePlan.mockResolvedValue(plan({ status: "approved", approvedBy: ACTOR }));
  R.listRoster.mockResolvedValue([]);
});

describe("manpower_planning_routes__4 (approve a plan)", () => {
  it("approves and generates a requisition instead of throwing ReferenceError: plan is not defined", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "manpower_planning_routes__4", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: PLAN }, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    // Regression guard for the second defect: the plan must be addressed by the
    // :id from the URL, NOT by the publish-time uuid in `p.id`.
    expect(R.getPlanTx.mock.calls[0]![2]).toBe(PLAN);
    expect(R.approvePlan).toHaveBeenCalledOnce();
    expect(R.approvePlan.mock.calls[0]![2]).toBe(PLAN);

    // sanctioned 9 − filled 2 = 7 recruitable vacancies (real computeVacancy)
    const req = R.insertRequisition.mock.calls[0]![1] as Record<string, any>;
    expect(req.planId).toBe(PLAN);
    expect(req.requestedVacancies).toBe(7);
    expect(req.unitId).toBe(UNIT);
    expect(req.cadre).toBe("Section Officer");
    expect(req.status).toBe("emitted");
    expect(req.requisitionNo).toMatch(/^MP-REQ-2028-[0-9A-F]{8}$/);

    // an auto roster is allocated because the maker set none
    expect(R.replaceRoster).toHaveBeenCalledOnce();
    const roster = R.replaceRoster.mock.calls[0]![3] as Array<Record<string, any>>;
    expect(roster.length).toBeGreaterThan(0);
    expect(roster.reduce((n, r) => n + r.reservedCount, 0)).toBe(7);

    // two outbox emissions: the recruitment job.create, then the audit event
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    const job = enqueueMock.mock.calls[0]![1] as Record<string, any>;
    expect(job.topic).toBe(COMMANDS.jobCreate);
    expect(job.payload.id).toBe(req.jobOpeningId);
    expect(job.payload.vacancies).toBe(7);
    expect(job.payload.isPublished).toBe(false);
    const audit = enqueueMock.mock.calls[1]![1] as Record<string, any>;
    expect(audit.topic).toBe("audit.event.record");
    expect(audit.payload.resourceId).toBe(PLAN);
    expect(audit.payload.action).toBe("approve");
    await q.stop();
  });

  it("keeps a manually-set roster instead of overwriting it", async () => {
    R.listRoster.mockResolvedValue([{ category: "UR", reservedCount: 7 }]);
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "manpower_planning_routes__4", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: PLAN }, query: {},
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(R.replaceRoster).not.toHaveBeenCalled();
    expect(R.insertRequisition).toHaveBeenCalledOnce();
    await q.stop();
  });

  it("approves without a requisition when the plan is fully staffed", async () => {
    R.getPlanTx.mockResolvedValue(plan({ sanctionedStrength: 5, filledStrength: 5 }));
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "manpower_planning_routes__4", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: PLAN }, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(R.approvePlan).toHaveBeenCalledOnce();
    expect(R.insertRequisition).not.toHaveBeenCalled();
    // only the audit event — no job.create for a zero-vacancy plan
    expect(enqueueMock).toHaveBeenCalledOnce();
    expect((enqueueMock.mock.calls[0]![1] as Record<string, any>).topic).toBe("audit.event.record");
    await q.stop();
  });

  it("honours the requisition title/refNo overrides from the request body", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "manpower_planning_routes__4", id: randomUUID(), tenantId: TENANT,
      body: { title: "Section Officer — Direct Recruitment", refNoPrefix: "DOPT" },
      params: { id: PLAN }, query: {},
    }));
    await q.drain();
    const job = enqueueMock.mock.calls[0]![1] as Record<string, any>;
    expect(job.payload.title).toBe("Section Officer — Direct Recruitment");
    expect(job.payload.refNo).toMatch(/^DOPT\/2028\/[0-9A-F]{8}$/);
    await q.stop();
  });

  it("drops the write when the plan is no longer pending approval (lost the race)", async () => {
    R.approvePlan.mockResolvedValue(null);
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "manpower_planning_routes__4", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: PLAN }, query: {},
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(R.insertRequisition).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("drops the write when the plan no longer exists", async () => {
    R.getPlanTx.mockResolvedValue(null);
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "manpower_planning_routes__4", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: PLAN }, query: {},
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(R.approvePlan).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("plan/requisition mutations address the row by path id", () => {
  it.each([
    ["manpower_planning_routes__1", () => R.updateDraftPlan, { sanctionedStrength: 9 }, PLAN],
    ["manpower_planning_routes__2", () => R.replaceRoster, { entries: [{ category: "UR", reservedCount: 3 }] }, PLAN],
    ["manpower_planning_routes__3", () => R.submitPlan, {}, PLAN],
    ["manpower_planning_routes__5", () => R.rejectPlan, {}, PLAN],
    ["manpower_planning_routes__6", () => R.markRequisitionAdvertised, { advertisementRef: "ADV/2028/1" }, REQUISITION],
  ])("%s targets the :id from the URL, not the publish-time uuid", async (op, getMock, body, pathId) => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op, id: randomUUID(), tenantId: TENANT, body, params: { id: pathId }, query: {},
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(getMock()).toHaveBeenCalledOnce();
    expect(getMock().mock.calls[0]![2]).toBe(pathId);
    await q.stop();
  });
});

describe("manpower_planning_routes__0 (create a draft plan)", () => {
  it("inserts the draft with the message-scoped id", async () => {
    const q = await buildQueue();
    const planId = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "manpower_planning_routes__0", id: planId, tenantId: TENANT,
      body: { planYear: 2028, unitId: UNIT, cadre: "Section Officer", requiredStrength: 10, sanctionedStrength: 9, filledStrength: 2 },
      params: {}, query: {},
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    const row = R.insertPlan.mock.calls[0]![1] as Record<string, any>;
    expect(row.id).toBe(planId);
    expect(row.status).toBe("draft");
    expect(row.createdBy).toBe(ACTOR);
    await q.stop();
  });
});
