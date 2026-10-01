/**
 * Department + Designation master routes — CRUD contract tests (Sprint 11)
 *
 * Covers:
 *  - GET  /v1/hrms/departments           — 200 list, 401 no-token
 *  - POST /v1/hrms/departments           — 202 accepted (async F3 write), 400 validation, 403 low-privilege
 *  - PATCH /v1/hrms/departments/:id      — 202 accepted, 404 not-found, 403 low-privilege
 *  - DELETE /v1/hrms/departments/:id     — 202 accepted, 404 not-found, 403 low-privilege
 *  - GAP-HR-DEPARTMENTS-01: GET includes a real employeeCount per row
 *  - GAP-HR-DEPARTMENTS-02: DELETE is blocked (409 DEPARTMENT_IN_USE) when a
 *    department still has child departments or active employees
 *  - GAP-HR-DEPARTMENTS-03: PATCH rejects a re-parent that would create a
 *    cycle, and derives `level` server-side from the new parent
 *
 * Pattern: buildApp() + app.inject() (no real DB — mocked via vi.mock).
 * Auth:    signToken (HS256) with test_secret_for_civitasone_32chr.
 *
 * masters-routes.ts's writes (create/update/delete) publish via publishF3Write
 * (CQRS) instead of mutating inline; the row is written by the employee F3
 * consumer that f3-leftover-register.ts wires into the worker in production.
 * Register that consumer here and drain the in-memory queue after each write
 * so the suite exercises the whole path instead of the HTTP layer alone — same
 * pattern as tests/interview-comms-route.test.ts / tests/manpower-routes.test.ts
 * etc. Previously this file asserted the OLD synchronous 200/201/204 codes
 * against a route that had already been correctly converted to 202 + async
 * write; the assertions were stale, not the route (see masters-routes.ts's own
 * "Synchronous pre-check" comments documenting the conversion).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance, InjectOptions } from "fastify";

// ── Shared constants ──────────────────────────────────────────────────────

const SECRET  = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT  = "aaaaaaaa-0001-4000-8000-000000000011";
const FAKE_ID = "00000000-cafe-4000-8000-ffffffffffff";
const NEW_ID  = "11111111-cafe-4000-8000-ffffffffffff";
const OTHER_ID = "22222222-cafe-4000-8000-ffffffffffff";

// ── Token helpers ─────────────────────────────────────────────────────────

function tok(roles: string[], sub = "dept-test-user") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-dept-test" }, SECRET);
}

const adminTok   = tok(["hr_admin", "super_admin"]);
const readonlyTok = tok(["hr_officer"]);
const noRoleTok  = tok(["viewer"]);

// ── DB mock ───────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  rows: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../shared/db.js", () => {
  /* Minimal Drizzle-like mock that lets handlers complete */
  const thenable = (val: unknown) => ({
    then: (res: (v: unknown) => unknown) => Promise.resolve(res(val)),
  });

  const whereChain = (rows: unknown) => ({
    ...thenable(rows),
    limit: (_n: unknown) => thenable(rows),
    orderBy: (..._o: unknown[]) => ({ limit: (_n: unknown) => thenable(rows) }),
  });

  const mockTx = {
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => whereChain(H.rows()),
        ...thenable(H.rows()),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        H.insert(v);
        return {
          returning: () => thenable([{ id: NEW_ID }]),
          // markProcessed() in the F3 consumer runs
          // insert(processed).values(...).onConflictDoNothing().returning() on
          // the tx before reaching any op's own case — every insert() call
          // needs this shape too, or a drained write throws before it ever
          // gets to the department/designation insert/update/delete below.
          onConflictDoNothing: () => ({ returning: () => thenable([{ messageId: "stub" }]) }),
        };
      },
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: (..._args: unknown[]) => {
          const r = H.update(v);
          return { returning: () => thenable(r) };
        },
      }),
    }),
    delete: () => ({
      where: (..._args: unknown[]) => {
        const r = H.delete();
        return { returning: () => thenable(r) };
      },
    }),
  };

  // TX-015: inlined, not imported from tests/fixtures/mock-sql-client.js --
  // this file lives under src/, whose tsconfig.json scopes rootDir to
  // ./src, and tsc --noEmit rejects any src/ file that reaches outside it.
  // Identical shape to createMockSqlClient(); see that file's doc comment.
  // The base must be a plain arrow function (not vi.fn(...)) for TS's
  // "properties on const functions" inference to allow the assignments
  // below -- see tests/fixtures/mock-sql-client.ts and
  // tests/id-cards-routes.test.ts for the same pattern.
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));

  return {
    db: {
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    },
    sqlClient: sqlClientFn,
    scopedRead: (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
  };
});

// ── App import (after mocks are hoisted) ─────────────────────────────────

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_employee_Consumers } from "../modules/employee/f3-consumer.js";

// masters-routes.ts's writes only PUBLISH; the row is written by the employee
// F3 consumer that f3-leftover-register.ts wires into the worker. Register it
// here so the suite exercises the whole write path instead of the HTTP layer
// alone — same pattern as tests/interview-comms-route.test.ts.
registerF3_employee_Consumers(queue);
/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
/**
 * inject() + drain, so an assertion never races the async F3 write.
 *
 * Typed directly against Fastify's own FastifyInstance/InjectOptions (unlike
 * the `type TestApp = { inject: (opts: never) => Promise<never> }` loose-cast
 * helper other e2e suites under tests/ use — that shape happens to typecheck
 * there only because tsconfig.json's `include` is `src/**` and tests/ isn't
 * covered by `tsc -p .` at all. This file lives under src/__tests__/, where
 * it IS covered, and the loose-cast version fails real type-checking
 * (FastifyInstance#inject is overloaded; `(opts: never) => Promise<never>`
 * isn't structurally assignable to it) — so use real types here instead of
 * reproducing a pattern that only "works" by never being checked.
 */
async function injectF3(app: FastifyInstance, opts: InjectOptions): Promise<Awaited<ReturnType<FastifyInstance["inject"]>>> {
  const res = await app.inject(opts);
  await drainF3();
  return res;
}

afterAll(async () => { await sqlClient.end(); });

// ── Helper ────────────────────────────────────────────────────────────────

function mockDept(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: FAKE_ID,
    tenantId: TENANT,
    code: "EST",
    name: "Establishment",
    parentId: null,
    type: null,
    level: null,
    govtTier: null,
    locationId: null,
    headEmployeeId: null,
    createdBy: "dept-test-user",
    updatedBy: "dept-test-user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * The mocked db.js's `.select().from().where()` chain calls H.rows() TWICE
 * per query -- once (discarded) while `.from()` eagerly builds an unused
 * `.then` fallback for the rare caller that awaits before ever calling
 * `.where()`, and once for real inside `.where()` itself (see this file's
 * `vi.mock("../shared/db.js", ...)` above). A test asserting on a single
 * query's result is unaffected (H.rows.mockReturnValue(x) is a blanket
 * default regardless of call count), but a test sequencing MULTIPLE
 * distinct queries within one request via `mockReturnValueOnce` must queue
 * each logical query's value twice, or the sequence desyncs by the 2nd
 * query onward. Queue one call per *query* here, not per H.rows()
 * invocation.
 */
function queueRows(...perQuery: unknown[]): void {
  for (const v of perQuery) {
    H.rows.mockReturnValueOnce(v).mockReturnValueOnce(v);
  }
}

// No shared beforeEach existed previously, which let mock state silently leak
// between tests (e.g. H.rows staying at whatever an earlier GET test left it
// at) — that leakage, not the route, was the real cause of the PATCH/DELETE
// 404s: the synchronous existence pre-check in masters-routes.ts reads
// H.rows(), and nothing in this file ever reset it back to "the department
// exists" before those tests ran. Reset explicitly before every test and let
// each test that needs a specific state set it.
beforeEach(() => {
  vi.clearAllMocks();
  H.rows.mockReturnValue([]);
  H.insert.mockReturnValue(undefined);
  H.update.mockReturnValue([{ id: FAKE_ID }]);
  H.delete.mockReturnValue([{ id: FAKE_ID }]);
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/hrms/departments
// ═══════════════════════════════════════════════════════════════════════════
describe("GET /v1/hrms/departments", () => {
  it("200 — returns department list with admin token", async () => {
    H.rows.mockReturnValue([mockDept()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
    const body = r.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("200 — payroll_officer can list departments (GAP-PAYROLL-DDOS-01: DDO department picker)", async () => {
    H.rows.mockReturnValue([mockDept()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${tok(["payroll_officer"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
  });

  it("403 — payroll_officer still cannot list designations (widening is departments-only)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/designations",
      headers: { authorization: `Bearer ${tok(["payroll_officer"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("200 — read-only hr_officer can list departments", async () => {
    H.rows.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${readonlyTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
  });

  it("401 — missing Authorization header is rejected", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/departments" });
    await app.close();
    expect([401, 403]).toContain(r.statusCode);
  });

  it("403 — viewer role cannot list departments", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${noRoleTok}` },
    });
    await app.close();
    expect([401, 403]).toContain(r.statusCode);
  });

  // GAP-HR-HR-DEPARTMENTS-01
  it("200 — each department row carries a real employeeCount (not always 0)", async () => {
    queueRows(
      [mockDept({ id: "d1" }), mockDept({ id: "d2", code: "FIN", name: "Finance" })],
      [{ departmentId: "d1" }, { departmentId: "d1" }, { departmentId: "d2" }],
    );
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
    const body = r.json<{ data: Array<{ id: string; employeeCount: number }> }>();
    expect(body.data.find((d) => d.id === "d1")?.employeeCount).toBe(2);
    expect(body.data.find((d) => d.id === "d2")?.employeeCount).toBe(1);
  });

  it("200 — a department with no employees gets employeeCount 0, not omitted", async () => {
    queueRows([mockDept({ id: "d1" })], []);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    const body = r.json<{ data: Array<{ employeeCount: number }> }>();
    expect(body.data[0]?.employeeCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/hrms/departments
// ═══════════════════════════════════════════════════════════════════════════
describe("POST /v1/hrms/departments", () => {
  const validBody = { code: "FIN", name: "Finance Department" };

  it("202 — admin creates a top-level department (accepted, async F3 write)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: validBody,
    });
    await app.close();
    expect(r.statusCode).toBe(202);
    const body = r.json<{ id: string; status: string }>();
    expect(body.status).toBe("created");
    expect(typeof body.id).toBe("string");
    // Confirms the drained consumer actually reached its insert case, not just
    // that the route replied — the same shape of fake-success this campaign
    // has been closing elsewhere (a 23505 duplicate on this same insert would
    // otherwise silently DLQ while the client was told "202 created").
    expect(H.insert).toHaveBeenCalled();
  });

  it("400 — missing name returns validation error", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { code: "X" }, // name missing
    });
    await app.close();
    expect(r.statusCode).toBe(400);
    const body = r.json<{ code: string }>();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("400 — empty code is rejected", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { code: "", name: "Finance" },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("403 — hr_officer (read-only) cannot create department", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${readonlyTok}`,
        "content-type": "application/json",
      },
      payload: validBody,
    });
    await app.close();
    expect([401, 403]).toContain(r.statusCode);
  });

  // GAP-HR-DEPARTMENTS-03
  it("202 — creating under a parent derives level server-side (client-sent level is ignored)", async () => {
    queueRows(
      [], // GAP-HR-DEPARTMENTS-NEW-02: duplicate-code lookup (runs first) finds nothing
      [mockDept({ id: OTHER_ID, level: 1 })], // parent lookup
    );
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { code: "SUB", name: "Sub Unit", parentId: OTHER_ID, level: 99 },
    });
    await app.close();
    expect(r.statusCode).toBe(202);
    expect(H.insert).toHaveBeenCalledWith(expect.objectContaining({ level: 2, parentId: OTHER_ID }));
  });

  it("400 — creating under a non-existent parent is rejected", async () => {
    queueRows(
      [], // duplicate-code lookup finds nothing
      [], // parent lookup finds nothing
    );
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { code: "SUB", name: "Sub Unit", parentId: OTHER_ID },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
    const body = r.json<{ code: string; fieldErrors?: Array<{ field: string; message: string }> }>();
    expect(body.code).toBe("PARENT_NOT_FOUND");
    // GAP-HR-DEPARTMENTS-NEW-01: surfaced under the Parent select on the
    // client, not only as a generic top-of-form message.
    expect(body.fieldErrors).toEqual([{ field: "parentId", message: "Selected parent department does not exist." }]);
  });

  // GAP-HR-DEPARTMENTS-NEW-02
  it("409 DUPLICATE_CODE — refuses to create a department with a case-insensitive duplicate code, and never publishes", async () => {
    queueRows([{ id: OTHER_ID }]); // duplicate-code lookup finds an existing row
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { code: "fin", name: "Finance Duplicate" },
    });
    await app.close();
    expect(r.statusCode).toBe(409);
    const body = r.json<{ code: string; fieldErrors?: Array<{ field: string; message: string }> }>();
    expect(body.code).toBe("DUPLICATE_CODE");
    expect(body.fieldErrors?.[0]).toMatchObject({ field: "code" });
    expect(H.insert).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /v1/hrms/departments/:id
// ═══════════════════════════════════════════════════════════════════════════
describe("PATCH /v1/hrms/departments/:id", () => {
  it("202 — admin updates an existing department (accepted, async F3 write)", async () => {
    // The route's synchronous existence pre-check reads this via scopedRead
    // BEFORE publishing — without it every PATCH 404s regardless of what the
    // (irrelevant, async-only) update mock returns.
    H.rows.mockReturnValue([mockDept()]);
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { name: "Renamed Finance" },
    });
    await app.close();
    expect(r.statusCode).toBe(202);
    const body = r.json<{ status: string }>();
    expect(body.status).toBe("updated");
    expect(H.update).toHaveBeenCalledOnce();
  });

  it("404 — updating a non-existent department", async () => {
    H.rows.mockReturnValue([]); // existence pre-check finds nothing
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { name: "Ghost Dept" },
    });
    await app.close();
    expect(r.statusCode).toBe(404);
    const body = r.json<{ code: string }>();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("403 — hr_officer cannot update department", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: {
        authorization: `Bearer ${readonlyTok}`,
        "content-type": "application/json",
      },
      payload: { name: "Attempt" },
    });
    await app.close();
    expect([401, 403]).toContain(r.statusCode);
  });

  // GAP-HR-DEPARTMENTS-03
  it("400 — a department cannot be re-parented under itself", async () => {
    queueRows([mockDept()]); // existence pre-check
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { parentId: FAKE_ID },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
    expect(r.json<{ code: string }>().code).toBe("HIERARCHY_CYCLE");
  });

  it("400 — a department cannot be re-parented under one of its own descendants", async () => {
    queueRows(
      [mockDept()],            // existence pre-check on FAKE_ID
      [{ parentId: FAKE_ID }], // isAncestor's walk: OTHER_ID's own parent is FAKE_ID
    );
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { parentId: OTHER_ID },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
    expect(r.json<{ code: string }>().code).toBe("HIERARCHY_CYCLE");
  });

  it("202 — a valid re-parent derives level from the new parent server-side", async () => {
    queueRows(
      [mockDept()],                            // existence pre-check on FAKE_ID
      [{ parentId: null }],                    // isAncestor's walk: OTHER_ID's parent is null (top-level, no cycle)
      [mockDept({ id: OTHER_ID, level: 3 })],   // parent lookup for level
    );
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { parentId: OTHER_ID },
    });
    await app.close();
    expect(r.statusCode).toBe(202);
    expect(H.update).toHaveBeenCalledWith(expect.objectContaining({ parentId: OTHER_ID, level: 4 }));
  });

  // GAP-HR-DEPARTMENTS-NEW-01
  it("400 — re-parenting under a non-existent parent carries a parentId field error", async () => {
    queueRows(
      [mockDept()],          // existence pre-check on FAKE_ID
      [{ parentId: null }],  // isAncestor's walk: OTHER_ID isn't a cycle
      [],                    // parent lookup finds nothing
    );
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { parentId: OTHER_ID },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
    const body = r.json<{ code: string; fieldErrors?: Array<{ field: string; message: string }> }>();
    expect(body.code).toBe("PARENT_NOT_FOUND");
    expect(body.fieldErrors).toEqual([{ field: "parentId", message: "Selected parent department does not exist." }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /v1/hrms/departments/:id
// ═══════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/hrms/departments/:id", () => {
  it("202 — admin deletes an empty, childless department (accepted, async F3 write)", async () => {
    // Same existence pre-check as PATCH, plus (GAP-HR-DEPARTMENTS-02) the new
    // childCount and employeeCount checks -- both zero, so delete proceeds.
    queueRows(
      [mockDept()],       // existence pre-check
      [{ childCount: 0 }], // child-department count
      [],                  // active-employee rows (none)
    );
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "DELETE",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(202);
    expect(H.delete).toHaveBeenCalledOnce();
  });

  it("404 — deleting a non-existent department returns 404", async () => {
    H.rows.mockReturnValue([]); // existence pre-check finds nothing
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "DELETE",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(404);
  });

  it("403 — hr_officer cannot delete department", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${readonlyTok}` },
    });
    await app.close();
    expect([401, 403]).toContain(r.statusCode);
  });

  // GAP-HR-DEPARTMENTS-02
  it("409 DEPARTMENT_IN_USE — refuses to delete a department that still has child departments, and never publishes", async () => {
    // Child-department count is 2 (blocking) -- the route still goes on to
    // compute employeeCount too (for a complete 409 payload) before it
    // checks either condition, so a 3rd query's worth of rows is queued
    // even though this test doesn't care what it is.
    queueRows([mockDept()], [{ childCount: 2 }], []);
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "DELETE",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(409);
    expect(r.json<{ code: string; childCount: number }>().code).toBe("DEPARTMENT_IN_USE");
    expect(H.delete).not.toHaveBeenCalled();
  });

  it("409 DEPARTMENT_IN_USE — refuses to delete a department that still has active employees, and never publishes", async () => {
    queueRows(
      [mockDept()],                 // existence pre-check
      [{ childCount: 0 }],           // no child departments
      [{ departmentId: FAKE_ID }],   // one active employee
    );
    const app = await buildApp();
    const r = await injectF3(app, {
      method: "DELETE",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(409);
    expect(r.json<{ code: string; employeeCount: number }>().employeeCount).toBe(1);
    expect(H.delete).not.toHaveBeenCalled();
  });
});
