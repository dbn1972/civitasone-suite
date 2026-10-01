/**
 * GAP-HR-SF-10 (Part 1) — attendance self-service IDOR / id-space bug.
 *
 * attendance/routes.ts used to scope/guard non-privileged ("employee")
 * callers on:
 *   GET  /v1/hrms/shift-requests
 *   GET  /v1/hrms/wfh-requests
 *   GET  /v1/hrms/overtime-requests
 *   POST /v1/hrms/overtime-requests
 *   POST /v1/hrms/wfh-requests
 *   POST /v1/hrms/shift-requests
 * with a raw `ctx.actorId` comparison against hrms_employees-linked
 * `employeeId` columns. `ctx.actorId` is the JWT subject (the login/account
 * id); `hrms_employees.id` is a separate id space linked via
 * `hrms_employees.user_ref` — see employee/actor-link.ts's
 * resolveEmployeeForActor doc comment. The two never coincide for a real
 * account, so:
 *   - every GET list for a plain "employee" caller came back empty (their
 *     own effectiveEmpId never matched any real employee_id row) — broken
 *     self-service, not a leak.
 *   - every POST create 403'd for the same caller submitting their OWN
 *     employeeId (body.employeeId !== ctx.actorId was always true).
 *
 * This suite proves the fix: self works, a DIFFERENT employee's records
 * remain inaccessible, and privileged (HR/manager) behavior is unchanged.
 *
 * Pattern: buildApp() + app.inject() + signToken(), matching sibling suites
 * in __tests__/ (e.g. leave-cancel-idor.test.ts). scopedRead and
 * resolveEmployeeForActor are vi.fn()s so each scenario controls exactly
 * what the DB/actor-link layer returns. For the GET list endpoints, the
 * list-query scopedRead call is given a small fake `tx` that captures the
 * real (unmocked) Drizzle `where(...)` condition the route built — letting
 * the test assert on the actual runtime id used for employeeId, proving it
 * came from the resolved employee id and not the raw actorId, without
 * depending on any particular row ever being "returned" by a query the
 * mock never really executes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-c001-4000-8000-0000000000f1";

// Deliberately DIFFERENT id spaces, matching the real bug: actorId is the
// JWT subject (login/account id); the *_ID-shaped constants below are
// hrms_employees.id (the linked employee row) — see employee/actor-link.ts.
const ACTOR_SELF   = "a0000000-0000-4000-8000-00000000a001"; // JWT sub, self
const EMP_SELF     = "11111111-0000-0000-0000-000000000001"; // self's linked employee row
const EMP_OTHER    = "22222222-0000-0000-0000-000000000002"; // a different employee
const ACTOR_NOLINK = "a0000000-0000-4000-8000-00000000a099"; // no hrms_employees row
const HR_ACTOR     = "50000000-0000-4000-8000-000000000005";
const MGR_ACTOR    = "60000000-0000-4000-8000-000000000006";
const MGR_EMP      = "60000000-0000-0000-0000-000000000066"; // manager's own linked row

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-attendance-sf10-p1" }, SECRET);
}

function empRow(id: string) {
  return {
    id, tenantId: TENANT, managerId: null, userRef: id,
    email: `${id}@test.gov.in`, employeeType: "permanent", status: "active",
    dateOfJoining: "2024-01-01",
  };
}

// --- Mocks ---

const scopedReadMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
const resolveEmployeeForActorMock = vi.fn();

vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: (...args: unknown[]) => scopedReadMock(...args),
  };
});

vi.mock("../shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => {}), subscribe: vi.fn(), drain: vi.fn(async () => {}) },
  cache: { get: vi.fn(async () => null), set: vi.fn(async () => {}), del: vi.fn(async () => {}) },
}));

// resolveEmployeeForActor is mocked directly (rather than driven through
// scopedRead's own internal lookup) so each test controls the resolved
// employee in one line, and so this suite stays independent of
// actor-link.ts's own implementation details (its email-fallback path etc.
// has its own coverage in actor-link-email-hijack-real-db.test.ts).
vi.mock("../modules/employee/actor-link.js", () => ({
  resolveEmployeeForActor: (...args: unknown[]) => resolveEmployeeForActorMock(...args),
}));

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
beforeEach(() => {
  scopedReadMock.mockReset();
  resolveEmployeeForActorMock.mockReset();
});

/**
 * Recursively walks a Drizzle SQL condition object's queryChunks/Param tree
 * and collects every bound literal value it finds. Deliberately does NOT
 * touch `.table`/column metadata (which is circular), so this is safe to
 * run against a real `and(eq(...), eq(...))` condition without needing
 * JSON.stringify.
 */
function paramValues(sql: unknown, out: unknown[] = []): unknown[] {
  // inArray(...) (added by the GAP-HR-SF-16 fix, for a manager's multi-id
  // scope) nests its bound parameter LIST as a bare array chunk within
  // queryChunks -- e.g. queryChunks[3] is `[Param]`, not an object exposing
  // `.value`/`.queryChunks` the way every other chunk type does. eq(...)'s
  // simpler shape never produces this, so this branch was never needed
  // before inArray was introduced here. Must run BEFORE the object branch
  // below (arrays are also typeof "object"), recursing into the array's own
  // elements directly rather than looking for value/queryChunks props on it.
  if (Array.isArray(sql)) {
    for (const c of sql) paramValues(c, out);
    return out;
  }
  if (sql && typeof sql === "object") {
    if ("value" in (sql as Record<string, unknown>)) out.push((sql as Record<string, unknown>).value);
    const chunks = (sql as Record<string, unknown>).queryChunks ?? (sql as Record<string, unknown>).value;
    if (Array.isArray(chunks)) for (const c of chunks) paramValues(c, out);
  }
  return out;
}

/**
 * A minimal fake Drizzle `tx` for a list-query scopedRead call: records the
 * exact `.where(...)` condition object the route built (using the real,
 * unmocked eq/and from drizzle-orm under the hood), then resolves `rows`.
 *
 * GAP-HR-OVERTIME-04: GET /overtime-requests now runs a SECOND query
 * alongside the data query (a bare `count()` aggregate, no further
 * chaining) inside the same scopedRead callback, and the data query itself
 * now chains `.offset(...)` after `.limit(...)`. `where(cond)` returns a
 * thenable that is ALSO chainable (`.orderBy`/`.limit`/`.offset` each return
 * another such hybrid), so a bare `await tx.select(...).where(...)` (the
 * count query) and any combination of further chaining (the data query)
 * both resolve to `rows` without throwing — exactly what every OTHER
 * capturingTx call site in this file already relied on before this gap, now
 * just also tolerant of the two new call shapes.
 */
function capturingTx(rows: unknown[]) {
  let captured: unknown;
  function hybrid(): Promise<unknown[]> & { orderBy: () => unknown; limit: () => unknown; offset: () => unknown } {
    const p = Promise.resolve(rows) as Promise<unknown[]> & { orderBy: () => unknown; limit: () => unknown; offset: () => unknown };
    p.orderBy = hybrid;
    p.limit = hybrid;
    p.offset = hybrid;
    return p;
  }
  const tx = {
    select: () => ({ from: () => ({ where: (cond: unknown) => { captured = cond; return hybrid(); } }) }),
  };
  return { tx, values: () => paramValues(captured).flat(Infinity) };
}

describe("POST /v1/hrms/overtime-requests — self-service IDOR", () => {
  it("202 — employee submits an overtime request for THEMSELVES (actorId != employeeId)", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    scopedReadMock.mockResolvedValueOnce([]); // GAP-HR-OVERTIME-NEW-04 duplicate-check: no existing pending/approved request for this employee+date
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
      payload: { employeeId: EMP_SELF, requestDate: "2026-10-01", hoursRequested: 2 },
    });
    expect(r.statusCode).toBe(202);
  });

  it("403 — employee CANNOT submit an overtime request for a DIFFERENT employee", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
      payload: { employeeId: EMP_OTHER, requestDate: "2026-10-01", hoursRequested: 2 },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("403 — employee with NO linked employee record cannot submit at all", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(undefined);
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_NOLINK)}` },
      payload: { employeeId: EMP_OTHER, requestDate: "2026-10-01", hoursRequested: 2 },
    });
    expect(r.statusCode).toBe(403);
  });

  it("202 — HR admin can submit on behalf of any employee (privileged path unchanged, no resolve needed)", async () => {
    scopedReadMock.mockResolvedValueOnce([]); // GAP-HR-OVERTIME-NEW-04 duplicate-check: no existing pending/approved request for this employee+date
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: { authorization: `Bearer ${tok(["hr_admin"], HR_ACTOR)}` },
      payload: { employeeId: EMP_OTHER, requestDate: "2026-10-01", hoursRequested: 2 },
    });
    expect(r.statusCode).toBe(202);
    expect(resolveEmployeeForActorMock).not.toHaveBeenCalled();
  });

  it("403 — a manager+employee actor still cannot submit on behalf of a DIFFERENT employee (create guard does not treat manager as privileged)", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(MGR_EMP));
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: { authorization: `Bearer ${tok(["manager", "employee"], MGR_ACTOR)}` },
      payload: { employeeId: EMP_OTHER, requestDate: "2026-10-01", hoursRequested: 2 },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/overtime-requests — self-scoping", () => {
  it("employee's list query is scoped to their OWN resolved employee id, ignoring an attempted ?empId override", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    const cap = capturingTx([]);
    scopedReadMock.mockImplementationOnce(async (cb: unknown) => (cb as (tx: unknown) => Promise<unknown[]>)(cap.tx));

    const r = await app.inject({
      method: "GET", url: `/v1/hrms/overtime-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
    });

    expect(r.statusCode).toBe(200);
    const values = cap.values();
    expect(values).toContain(EMP_SELF);
    expect(values).not.toContain(EMP_OTHER);
    expect(values).not.toContain(ACTOR_SELF);
  });

  it("employee with no linked employee record gets an empty list, not a query", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(undefined);
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/overtime-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_NOLINK)}` },
    });
    expect(r.statusCode).toBe(200);
    // GAP-HR-OVERTIME-04: this short-circuit now also carries hasMore/total
    // (both trivially false/0), alongside the pre-existing empty data: [].
    expect(r.json()).toEqual({ data: [], hasMore: false, total: 0 });
    expect(scopedReadMock).not.toHaveBeenCalled();
  });

  it("GAP-HR-SF-16: manager filtering by a genuine direct report's empId succeeds (their own identity IS now resolved, to verify the report relationship — not blindly trusted)", async () => {
    const cap = capturingTx([]);
    // 1st scopedRead: the manager's own direct-reports lookup (new, added by
    // the GAP-HR-SF-16 fix) -- EMP_OTHER is seeded here as a real report so
    // the requested empId is authorised. 2nd scopedRead: the actual data
    // query, captured to prove the runtime filter really is EMP_OTHER.
    scopedReadMock.mockResolvedValueOnce([{ id: EMP_OTHER }]);
    scopedReadMock.mockImplementationOnce(async (cb: unknown) => (cb as (tx: unknown) => Promise<unknown[]>)(cap.tx));
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(MGR_EMP));
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/overtime-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["manager"], MGR_ACTOR)}` },
    });
    expect(r.statusCode).toBe(200);
    // Pre-GAP-HR-SF-16 this asserted the OPPOSITE (resolveEmployeeForActor
    // NOT called) -- that was the vulnerability: a manager's explicit empId
    // was passed straight through with no ownership check at all, so any
    // manager could read ANY employee's (not just a report's) requests.
    expect(resolveEmployeeForActorMock).toHaveBeenCalledWith(TENANT, MGR_ACTOR);
    expect(cap.values()).toContain(EMP_OTHER);
  });

  it("GAP-HR-SF-16: manager filtering by an empId that is NOT their direct report is denied (empty), not passed through", async () => {
    scopedReadMock.mockResolvedValueOnce([]); // manager has no reports matching EMP_OTHER
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(MGR_EMP));
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/overtime-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["manager"], MGR_ACTOR)}` },
    });
    expect(r.statusCode).toBe(200);
    // GAP-HR-OVERTIME-04: see the "no linked employee record" test above.
    expect(r.json()).toEqual({ data: [], hasMore: false, total: 0 });
    // Only the reports-lookup scopedRead call happens -- the route must
    // short-circuit before ever building/running the data query.
    expect(scopedReadMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /v1/hrms/wfh-requests — self-service IDOR", () => {
  const body = { fromDate: "2026-10-01", toDate: "2026-10-02" };

  it("202 — employee submits a WFH request for THEMSELVES (actorId != employeeId)", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    // GAP-HR-WFH-01 (partial, weekly-cap check): no existing pending/approved
    // WFH request for this employee in the same ISO week.
    scopedReadMock.mockResolvedValueOnce([]);
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
      payload: { ...body, employeeId: EMP_SELF },
    });
    expect(r.statusCode).toBe(202);
  });

  it("403 — employee CANNOT submit a WFH request for a DIFFERENT employee", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
      payload: { ...body, employeeId: EMP_OTHER },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("202 — HR admin can submit on behalf of any employee (privileged path unchanged)", async () => {
    // GAP-HR-WFH-01 (partial, weekly-cap check): applies regardless of who
    // is submitting, HR included — no existing same-week request here.
    scopedReadMock.mockResolvedValueOnce([]);
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { authorization: `Bearer ${tok(["hr_admin"], HR_ACTOR)}` },
      payload: { ...body, employeeId: EMP_OTHER },
    });
    expect(r.statusCode).toBe(202);
    expect(resolveEmployeeForActorMock).not.toHaveBeenCalled();
  });
});

describe("GET /v1/hrms/wfh-requests — self-scoping", () => {
  it("employee's list query is scoped to their OWN resolved employee id, ignoring an attempted ?empId override", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    const cap = capturingTx([]);
    scopedReadMock.mockImplementationOnce(async (cb: unknown) => (cb as (tx: unknown) => Promise<unknown[]>)(cap.tx));
    scopedReadMock.mockResolvedValueOnce([]); // employeeRepo.listByTenant (builds the display-name map)

    const r = await app.inject({
      method: "GET", url: `/v1/hrms/wfh-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
    });

    expect(r.statusCode).toBe(200);
    const values = cap.values();
    expect(values).toContain(EMP_SELF);
    expect(values).not.toContain(EMP_OTHER);
    expect(values).not.toContain(ACTOR_SELF);
  });

  it("employee with no linked employee record gets an empty list, not a query", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(undefined);
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/wfh-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_NOLINK)}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: [] });
    expect(scopedReadMock).not.toHaveBeenCalled();
  });

  it("HR can still filter by an explicit empId (privileged path unaffected)", async () => {
    const cap = capturingTx([]);
    scopedReadMock.mockImplementationOnce(async (cb: unknown) => (cb as (tx: unknown) => Promise<unknown[]>)(cap.tx));
    scopedReadMock.mockResolvedValueOnce([]);
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/wfh-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["hr_admin"], HR_ACTOR)}` },
    });
    expect(r.statusCode).toBe(200);
    expect(resolveEmployeeForActorMock).not.toHaveBeenCalled();
    expect(cap.values()).toContain(EMP_OTHER);
  });
});

describe("POST /v1/hrms/shift-requests — self-service IDOR", () => {
  const body = { currentShift: "Morning", requestedShift: "Evening", effectiveDate: "2026-10-01" };

  it("202 — employee submits a shift-change request for THEMSELVES (actorId != employeeId)", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/shift-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
      payload: { ...body, employeeId: EMP_SELF },
    });
    expect(r.statusCode).toBe(202);
  });

  it("403 — employee CANNOT submit a shift-change request for a DIFFERENT employee", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/shift-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
      payload: { ...body, employeeId: EMP_OTHER },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("202 — HR admin can submit on behalf of any employee (privileged path unchanged)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/shift-requests",
      headers: { authorization: `Bearer ${tok(["hr_admin"], HR_ACTOR)}` },
      payload: { ...body, employeeId: EMP_OTHER },
    });
    expect(r.statusCode).toBe(202);
    expect(resolveEmployeeForActorMock).not.toHaveBeenCalled();
  });
});

describe("GET /v1/hrms/shift-requests — self-scoping", () => {
  it("employee's list query is scoped to their OWN resolved employee id, ignoring an attempted ?empId override", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF));
    const cap = capturingTx([]);
    scopedReadMock.mockImplementationOnce(async (cb: unknown) => (cb as (tx: unknown) => Promise<unknown[]>)(cap.tx));
    scopedReadMock.mockResolvedValueOnce([]); // employeeRepo.listByTenant

    const r = await app.inject({
      method: "GET", url: `/v1/hrms/shift-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_SELF)}` },
    });

    expect(r.statusCode).toBe(200);
    const values = cap.values();
    expect(values).toContain(EMP_SELF);
    expect(values).not.toContain(EMP_OTHER);
    expect(values).not.toContain(ACTOR_SELF);
  });

  it("employee with no linked employee record gets an empty list, not a query", async () => {
    resolveEmployeeForActorMock.mockResolvedValueOnce(undefined);
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/shift-requests",
      headers: { authorization: `Bearer ${tok(["employee"], ACTOR_NOLINK)}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: [] });
    expect(scopedReadMock).not.toHaveBeenCalled();
  });

  it("GAP-HR-SF-16: manager filtering by a genuine direct report's empId succeeds (their own identity IS now resolved, to verify the report relationship — not blindly trusted)", async () => {
    const cap = capturingTx([]);
    // Call order for a manager under the GAP-HR-SF-16 fix: 1) their own
    // direct-reports lookup (new) -- EMP_OTHER seeded as a real report;
    // 2) the actual data query (captured); 3) employeeRepo.listByTenant,
    // used unconditionally to build the response's employeeName map.
    scopedReadMock.mockResolvedValueOnce([{ id: EMP_OTHER }]);
    scopedReadMock.mockImplementationOnce(async (cb: unknown) => (cb as (tx: unknown) => Promise<unknown[]>)(cap.tx));
    scopedReadMock.mockResolvedValueOnce([]); // employeeRepo.listByTenant
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(MGR_EMP));
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/shift-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["manager"], MGR_ACTOR)}` },
    });
    expect(r.statusCode).toBe(200);
    // Pre-GAP-HR-SF-16 this asserted the OPPOSITE (resolveEmployeeForActor
    // NOT called) -- that was the vulnerability: a manager's explicit empId
    // was passed straight through with no ownership check at all.
    expect(resolveEmployeeForActorMock).toHaveBeenCalledWith(TENANT, MGR_ACTOR);
    expect(cap.values()).toContain(EMP_OTHER);
  });

  it("GAP-HR-SF-16: manager filtering by an empId that is NOT their direct report is denied (empty), not passed through", async () => {
    scopedReadMock.mockResolvedValueOnce([]); // manager has no reports matching EMP_OTHER
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(MGR_EMP));
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/shift-requests?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${tok(["manager"], MGR_ACTOR)}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: [] });
    expect(scopedReadMock).toHaveBeenCalledTimes(1);
  });
});
