/**
 * Department + Designation master routes — CRUD contract tests (Sprint 11)
 *
 * Covers:
 *  - GET  /v1/hrms/departments           — 200 list, 401 no-token
 *  - POST /v1/hrms/departments           — 201 created, 400 validation, 403 low-privilege
 *  - PATCH /v1/hrms/departments/:id      — 200 updated, 404 not-found, 403 low-privilege
 *  - DELETE /v1/hrms/departments/:id     — 204 deleted, 403 low-privilege
 *
 * Pattern: buildApp() + app.inject() (no real DB — mocked via vi.mock).
 * Auth:    signToken (HS256) with test_secret_for_civitasone_32chr.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

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

  it("201 — admin creates a department", async () => {
    H.insert.mockReturnValue(undefined);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/departments",
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: validBody,
    });
    await app.close();
    expect(r.statusCode).toBe(201);
    const body = r.json<{ id: string; status: string }>();
    expect(body.status).toBe("created");
    expect(typeof body.id).toBe("string");
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
  it("200 — admin updates an existing department", async () => {
    H.update.mockReturnValue([{ id: FAKE_ID }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: {
        authorization: `Bearer ${adminTok}`,
        "content-type": "application/json",
      },
      payload: { name: "Renamed Finance" },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
    const body = r.json<{ status: string }>();
    expect(body.status).toBe("updated");
  });

  it("404 — updating a non-existent department", async () => {
    H.update.mockReturnValue([]); // empty = not found
    const app = await buildApp();
    const r = await app.inject({
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
  it("204 — admin deletes an existing department", async () => {
    H.delete.mockReturnValue([{ id: FAKE_ID }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/hrms/departments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${adminTok}` },
    });
    await app.close();
    expect(r.statusCode).toBe(204);
  });

  it("404 — deleting a non-existent department returns 404", async () => {
    H.delete.mockReturnValue([]); // empty = not found
    const app = await buildApp();
    const r = await app.inject({
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
