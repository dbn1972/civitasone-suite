/**
 * Department + Designation master routes — CRUD contract tests (Sprint 11)
 *
 * Covers:
 *  - GET  /v1/hrms/departments           — 200 list, 401 no-token
 *  - POST /v1/hrms/departments           — 202 accepted (async F3 write), 400 validation, 403 low-privilege
 *  - PATCH /v1/hrms/departments/:id      — 202 accepted, 404 not-found, 403 low-privilege
 *  - DELETE /v1/hrms/departments/:id     — 202 accepted, 404 not-found, 403 low-privilege
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

  return {
    db: {
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    },
    sqlClient: { end: async () => undefined },
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

function mockDept() {
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
  };
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
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/hrms/departments
// ═══════════════════════════════════════════════════════════════════════════
describe("POST /v1/hrms/departments", () => {
  const validBody = { code: "FIN", name: "Finance Department" };

  it("202 — admin creates a department (accepted, async F3 write)", async () => {
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
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /v1/hrms/departments/:id
// ═══════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/hrms/departments/:id", () => {
  it("202 — admin deletes an existing department (accepted, async F3 write)", async () => {
    // Same existence pre-check as PATCH — required or this 404s regardless of
    // the delete mock.
    H.rows.mockReturnValue([mockDept()]);
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
});
