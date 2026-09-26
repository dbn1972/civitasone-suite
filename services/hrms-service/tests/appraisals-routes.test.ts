/**
 * Appraisals + feedback route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden,
 * 404 not found, 409 conflict for all endpoints in routes.ts and feedback-routes.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createMockSqlClient } from "./fixtures/mock-sql-client.js";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const APPRAISAL_ID = "cccccccc-0001-4000-8000-000000000001";
const REVIEWER_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  // repo/queries mocks
  listAppraisals: vi.fn(),
  findById: vi.fn(),
  listByTenant: vi.fn(),
  listByTenantEmp: vi.fn(),
  // actor->employee identity resolution (SoD fix) -- see
  // employee/actor-link.js's resolveEmployeeForActor.
  resolveEmployeeForActor: vi.fn(),
}));

// A real in-memory queue so the async F3 write consumer actually runs in tests.
const Q = await vi.hoisted(async () => {
  const { MemoryQueue } = await import("@civitasone/queue");
  return { queue: new MemoryQueue() };
});

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args) }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        const res = H.insert(v);
        // markProcessed() claims the message with ON CONFLICT DO NOTHING ... RETURNING and
        // treats an empty result as "already processed"; without this the F3 consumer bails
        // out before the switch and no write is exercised.
        return Object.assign(
          res && typeof res === "object" ? res : {},
          { onConflictDoNothing: () => ({ returning: () => [{ messageId: "stub" }] }) },
        );
      },
    }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: createMockSqlClient(),
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    listKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: Q.queue,
}));

vi.mock("../src/modules/appraisals/queries.js", () => ({
  listAppraisals: (...a: unknown[]) => H.listAppraisals(...a),
}));

vi.mock("../src/modules/appraisals/repo.js", () => ({
  findById: (...a: unknown[]) => H.findById(...a),
  listByTenant: (...a: unknown[]) => H.listByTenant(...a),
  insertAppraisal: async () => undefined,
  updateAppraisal: async () => undefined,
}));

vi.mock("../src/modules/employee/repo.js", () => ({
  listByTenant: (...a: unknown[]) => H.listByTenantEmp(...a),
  findById: async () => ({ id: EMP, fullName: "Test User", departmentId: "dept-1" }),
  insertEmployee: async () => undefined,
  updateEmployee: async () => undefined,
}));

// Mocked wholesale (like repo.js above) so PATCH .../stage's ownership tests
// control the caller<->employee link deterministically instead of needing a
// real DB row -- same convention apar-routes.test.ts uses for the identical
// dependency.
vi.mock("../src/modules/employee/actor-link.js", () => ({
  resolveEmployeeForActor: (...a: unknown[]) => H.resolveEmployeeForActor(...a),
  extractActorEmail: () => undefined,
}));

import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_appraisals_Consumers } from "../src/modules/appraisals/f3-consumer.js";

// 360-feedback / disclosure / appeal all answer 201 as soon as the insert is QUEUED; the
// real write happens in this consumer. Without registering + draining it, these tests
// asserted only the optimistic HTTP response and stayed green while the consumer crashed
// on undefined `fid` / `did` / `aid` locals and never inserted a row.
registerF3_appraisals_Consumers(queue);
async function drainF3() {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
function f3Dlq() {
  return (queue as unknown as import("@civitasone/queue").MemoryQueue).dlq;
}

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function appraisalRow(over: Record<string, unknown> = {}) {
  return {
    id: APPRAISAL_ID, tenantId: TENANT, employeeId: EMP,
    appraisalPeriod: "2025-2026", rating: "4.5", status: "self_pending",
    reviewerId: REVIEWER_ID, createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.listAppraisals.mockResolvedValue([
    { id: APPRAISAL_ID, employeeId: EMP, employeeName: "Test", department: "HR", appraisalPeriod: "2025-2026", rating: 4.5, status: "pending" },
  ]);
  H.findById.mockResolvedValue(appraisalRow());
  H.listByTenant.mockResolvedValue([appraisalRow()]);
  H.listByTenantEmp.mockResolvedValue([{ id: EMP, fullName: "Test User", departmentId: "dept-1" }]);
  // Fail-closed default: no linked employee row unless a test opts in.
  // PATCH .../stage's ownership tests below set this explicitly per-case.
  H.resolveEmployeeForActor.mockResolvedValue(undefined);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── GET /v1/hrms/appraisals ───────────────────────────────────────────────────

describe("GET /v1/hrms/appraisals", () => {
  it("200 — returns appraisal list", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(APPRAISAL_ID);
    await app.close();
  });

  it("200 — returns empty list when no appraisals", async () => {
    H.listAppraisals.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(0);
    await app.close();
  });

  it("200 — manager role can read", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(USER, ["manager"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  // --- read-scope regression (Bug 2/IDOR fix): the route resolves a scope
  // and forwards it to queries.listAppraisals as its 3rd argument. This
  // file mocks queries.js wholesale (so it can't prove the real filtering --
  // see the new real-DB appraisals-identity-resolution.test.ts for that),
  // but it DOES prove routes.ts computes the right scope for each caller
  // and actually passes it through, mirroring
  // apar-routes.test.ts's own "read-scope regression" block.

  it("hr_admin: unrestricted scope (null) is passed to queries.listAppraisals", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(USER, ["hr_admin"]) });
    expect(H.listAppraisals).toHaveBeenCalledWith(TENANT, expect.any(Number), null);
    await app.close();
  });

  it("manager with no resolvable employee link is scoped to an empty array (fails closed)", async () => {
    H.resolveEmployeeForActor.mockResolvedValue(undefined);
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(USER, ["manager"]) });
    expect(H.listAppraisals).toHaveBeenCalledWith(TENANT, expect.any(Number), []);
    await app.close();
  });

  it("manager with resolvable direct reports is scoped to their employeeIds only", async () => {
    const MANAGER_EMP = "eeeeeeee-0008-4000-8000-000000000001";
    const REPORT_1 = "eeeeeeee-0009-4000-8000-000000000001";
    const REPORT_2 = "eeeeeeee-0010-4000-8000-000000000001";
    H.resolveEmployeeForActor.mockResolvedValue({ id: MANAGER_EMP });
    H.listByTenantEmp.mockResolvedValue([
      { id: REPORT_1, fullName: "Report One", departmentId: "dept-1" },
      { id: REPORT_2, fullName: "Report Two", departmentId: "dept-1" },
    ]);
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(USER, ["manager"]) });
    const call = H.listAppraisals.mock.calls[0] as [string, number, string[] | null];
    expect(call[2]).not.toBeNull();
    expect(new Set(call[2])).toEqual(new Set([REPORT_1, REPORT_2]));
    // listByTenant(managerId) is the real employee/repo.ts direct-reports
    // lookup -- confirm it was queried BY the resolved manager employee id.
    expect(H.listByTenantEmp).toHaveBeenCalledWith(TENANT, 500, 0, undefined, MANAGER_EMP);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role cannot list", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — every row survives response validation across the full shared status vocabulary (legacy + in-progress + APAR terminal stages)", async () => {
    // hrms_appraisals.status is written by TWO route modules on the SAME
    // column (this module's 5-stage APPRAISAL_STAGES and apar/routes.ts's
    // 7-stage APAR_STAGES, which continues on to disclosed/representation/
    // finalised -- see routes.ts's header comment). sendValidated's
    // schema.parse() 400s the ENTIRE array if even one row fails, so the
    // regression test needs the full union, not just the happy-path
    // pending/in_review/completed -- that gap is exactly what let any
    // tenant with real APAR usage 400 on this endpoint, permanently.
    // disclosed/representation/finalised aren't insertable against a real
    // DB yet (a separate, pre-existing CHECK-constraint gap tracked and
    // fixed on its own -- see migrations/0111_apar_status_check.sql); using
    // the mocked queries.listAppraisals here proves the RESPONSE SCHEMA is
    // already forward-compatible with that fix landing. The real-DB
    // equivalent for everything the live DB accepts today lives in
    // appraisals-identity-resolution.test.ts.
    const statuses = [
      "pending", "in_review", "self_pending", "reporting_officer",
      "reviewing_officer", "accepting_authority", "disclosed", "representation",
      "finalised", "completed",
    ] as const;
    const rows = statuses.map((status, i) => ({
      id: `row-${i}`, employeeId: EMP, employeeName: `Employee ${i}`, department: "HR",
      appraisalPeriod: "2025-2026", status,
    }));
    H.listAppraisals.mockResolvedValue(rows);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Array<{ id: string; status: string }>;
    expect(body).toHaveLength(statuses.length);
    expect(body.map((a) => a.status)).toEqual([...statuses]);
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals ──────────────────────────────────────────────────

describe("POST /v1/hrms/appraisals", () => {
  const payload = { employeeId: EMP, appraisalPeriod: "2025-2026" };

  it("202 — creates appraisal (command published)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    await app.close();
  });

  it("202 — with optional reviewerId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals", headers: auth(),
      payload: { ...payload, reviewerId: REVIEWER_ID },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload: { appraisalPeriod: "2025-2026" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid employeeId (not uuid)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload: { employeeId: "not-uuid", appraisalPeriod: "2025-2026" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — appraisalPeriod too short", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload: { employeeId: EMP, appraisalPeriod: "25" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(USER, ["manager"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — employee cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── PATCH /v1/hrms/appraisals/:id/stage ───────────────────────────────────────

describe("PATCH /v1/hrms/appraisals/:id/stage", () => {
  const payload = { stage: "reporting_officer" };

  // --- SoD / stage-ownership regression (C2/IDOR fix) ------------------------
  // Bug 1 fix: PATCH .../stage now requires the caller to resolve (via
  // resolveEmployeeForActor) to the hrms_employees.id actually named as the
  // owner of the appraisal's CURRENT stage -- reportingOfficerId /
  // reviewingOfficerId / acceptingAuthorityId / employeeId, matching
  // whichever column apraisalStageOwner() maps the current status to.
  // Holding "hr_admin"/"manager" (the route's coarse role gate) is
  // necessary but no longer sufficient, mirroring apar/routes.ts's
  // assertStageOwner exactly: only super_admin may override.

  it("202 — advances stage when the caller resolves to the current stage's owner", async () => {
    const OFFICER = "eeeeeeee-0001-4000-8000-000000000001";
    H.findById.mockResolvedValue(appraisalRow({ status: "reporting_officer", reportingOfficerId: OFFICER }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: OFFICER });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBe(APPRAISAL_ID);
    expect(body.status).toBe("accepted");
    await app.close();
  });

  it("202 — manager can advance stage when they resolve to the actual reporting officer", async () => {
    const OFFICER = "eeeeeeee-0002-4000-8000-000000000001";
    H.findById.mockResolvedValue(appraisalRow({ status: "reporting_officer", reportingOfficerId: OFFICER }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: OFFICER });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["manager"]), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("403 — manager holding the role but NOT the resolved stage owner cannot advance (closes Bug 1)", async () => {
    H.findById.mockResolvedValue(appraisalRow({ status: "reporting_officer", reportingOfficerId: "eeeeeeee-0003-4000-8000-000000000001" }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: "ffffffff-0001-4000-8000-000000000001" }); // not the officer
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["manager"]), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_STAGE_OWNER");
    await app.close();
  });

  it("403 — hr_admin is NOT an automatic bypass for stage ownership (only super_admin overrides)", async () => {
    H.findById.mockResolvedValue(appraisalRow({ status: "reporting_officer", reportingOfficerId: "eeeeeeee-0004-4000-8000-000000000001" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["hr_admin"]), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_STAGE_OWNER");
    await app.close();
  });

  it("202 — super_admin may explicitly override as a privileged, audited action", async () => {
    H.findById.mockResolvedValue(appraisalRow({ status: "reporting_officer", reportingOfficerId: "eeeeeeee-0005-4000-8000-000000000001" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["super_admin"]), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("403 — the appraisee can never act as their own officer, even as a would-be super_admin override", async () => {
    // Self-review-forbidden is checked BEFORE the super_admin-override
    // branch in assertAppraisalStageOwner, mirroring
    // apar/routes.ts's assertStageOwner: no role can override self-dealing.
    H.findById.mockResolvedValue(appraisalRow({ status: "reporting_officer", employeeId: EMP, reportingOfficerId: "eeeeeeee-0007-4000-8000-000000000001" }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: EMP }); // caller IS the appraisee
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["super_admin"]), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SELF_REVIEW_FORBIDDEN");
    await app.close();
  });

  // --- monotonic stage-order regression (closes "any enum value accepted") ---

  it("409 — cannot jump straight to 'completed' from 'self_pending' (was previously accepted)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: { stage: "completed", rating: "4.5" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STAGE");
    await app.close();
  });

  it("409 — cannot replay an earlier stage", async () => {
    H.findById.mockResolvedValue(appraisalRow({ status: "reviewing_officer", reportingOfficerId: EMP }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: EMP });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: { stage: "reporting_officer" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STAGE");
    await app.close();
  });

  it("202 — with optional rating, on a legitimate immediate transition owned by the accepting authority", async () => {
    const OFFICER = "eeeeeeee-0006-4000-8000-000000000001";
    H.findById.mockResolvedValue(appraisalRow({ status: "accepting_authority", acceptingAuthorityId: OFFICER }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: OFFICER });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: { stage: "completed", rating: "4.5" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — invalid UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/appraisals/not-a-uuid/stage",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid stage value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: { stage: "invalid_stage" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing stage field", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot advance stage", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — appraisal not found", async () => {
    H.findById.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals/:id/360-feedback ─────────────────────────────────

describe("POST /v1/hrms/appraisals/:id/360-feedback", () => {
  const payload = { reviewerId: REVIEWER_ID, relationship: "peer" };

  it("201 — submits 360 feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.appraisalId).toBe(APPRAISAL_ID);
    // The 201 above is only an ACK that the insert was queued. Drain and assert the
    // consumer actually wrote the feedback row against the right appraisal.
    await drainF3();
    expect(f3Dlq()).toHaveLength(0);
    expect(H.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, appraisalId: APPRAISAL_ID,
      reviewerId: REVIEWER_ID, relationship: "peer",
    }));
    await app.close();
  });

  it("201 — with optional ratings and comments", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { ...payload, ratings: "4.5", comments: "Great performance" },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("201 — employee can submit feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("400 — missing reviewerId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { relationship: "peer" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid relationship enum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { reviewerId: REVIEWER_ID, relationship: "cousin" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid appraisal UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals/bad-uuid/360-feedback",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid reviewerId (not uuid)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { reviewerId: "not-a-uuid", relationship: "peer" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — viewer cannot submit feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["viewer"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── GET /v1/hrms/appraisals/:id/360-feedback ──────────────────────────────────

describe("GET /v1/hrms/appraisals/:id/360-feedback", () => {
  it("200 — returns feedback list", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "f1", tenantId: TENANT, appraisalId: APPRAISAL_ID, reviewerId: REVIEWER_ID, relationship: "peer", ratings: null, comments: "Good", submittedAt: new Date() },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("200 — empty list when no feedback", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("400 — invalid UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/appraisals/bad-uuid/360-feedback",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot list feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot list feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals/:id/disclosure ───────────────────────────────────

describe("POST /v1/hrms/appraisals/:id/disclosure", () => {
  const payload = { employeeId: EMP };

  it("201 — discloses APAR to employee", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.appraisalId).toBe(APPRAISAL_ID);
    expect(body.disclosed).toBe(true);
    await drainF3();
    expect(f3Dlq()).toHaveLength(0);
    expect(H.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, appraisalId: APPRAISAL_ID, employeeId: EMP,
    }));
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid employeeId (not uuid)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(), payload: { employeeId: "not-uuid" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid appraisal UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals/bad-uuid/disclosure",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot disclose", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot disclose", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(USER, ["manager"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals/:id/appeal ───────────────────────────────────────

describe("POST /v1/hrms/appraisals/:id/appeal", () => {
  const payload = { employeeId: EMP, appealReason: "I believe the rating does not reflect my contributions during Q3 and Q4." };

  it("201 — files a rating appeal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.appraisalId).toBe(APPRAISAL_ID);
    expect(body.status).toBe("filed");
    await drainF3();
    expect(f3Dlq()).toHaveLength(0);
    expect(H.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, appraisalId: APPRAISAL_ID, employeeId: EMP,
      appealReason: payload.appealReason,
      // routes.ts declares pipLinked as z.boolean().default(false); the queued body is raw,
      // so the consumer must reapply that default rather than writing undefined.
      pipLinked: false,
    }));
    await app.close();
  });

  it("201 — with pipLinked true", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { ...payload, pipLinked: true },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("201 — hr_admin can file on behalf", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("400 — missing appealReason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { employeeId: EMP },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — appealReason too short", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { employeeId: EMP, appealReason: "short" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { appealReason: "I believe the rating is unfair and needs review." },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid appraisal UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals/bad-uuid/appeal",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — viewer cannot file appeal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(USER, ["viewer"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── GET /v1/hrms/appraisals/:id/appeals ───────────────────────────────────────

describe("GET /v1/hrms/appraisals/:id/appeals", () => {
  it("200 — returns appeals list", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "a1", tenantId: TENANT, appraisalId: APPRAISAL_ID, employeeId: EMP, appealReason: "Unfair rating", status: "filed", pipLinked: false },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("200 — empty list when no appeals", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("400 — invalid UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/appraisals/bad-uuid/appeals",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot list appeals", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot list appeals", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
