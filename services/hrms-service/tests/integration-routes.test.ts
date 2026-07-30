/**
 * Integration module route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden,
 * 404 not found, 422 business rule violation.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const INT_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args) }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx), execute: (q: unknown) => H.execute(q) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async (...args: unknown[]) => H.poolQuery(...args) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
    listKey: (...a: string[]) => a.join(":"),
    listOrLoad: async (_t: string, _ns: string, _k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.execute.mockResolvedValue([]);
  H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── GET /v1/hrms/integrations (list) ───────────────────────────────────────

describe("GET /v1/hrms/integrations", () => {
  it("200 — returns integration list", async () => {
    H.poolQuery.mockResolvedValue({
      rows: [
        { id: INT_ID, name: "eHRMS Sync", type: "ehrms", status: "active", last_sync_at: null, config: {} },
      ],
      rowCount: 1,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].name).toBe("eHRMS Sync");
    await app.close();
  });

  it("200 — empty list when no integrations", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("200 — super_admin can access", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations",
      headers: auth(USER, ["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — platform_admin can access", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations",
      headers: auth(USER, ["platform_admin"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role cannot access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — hr_officer cannot access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations",
      headers: auth(USER, ["hr_officer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/integrations (create) ────────────────────────────────────

describe("POST /v1/hrms/integrations", () => {
  const validBody = {
    name: "PFMS Payroll Feed",
    type: "pfms_payroll",
    config: { endpoint: "https://pfms.gov.in/api" },
  };

  it("201 — creates a new integration", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(),
      payload: validBody,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.data.name).toBe("PFMS Payroll Feed");
    expect(body.data.type).toBe("pfms_payroll");
    expect(body.data.status).toBe("active");
    expect(body.data.id).toBeDefined();
    await app.close();
  });

  it("201 — creates with minimal body (no config)", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(),
      payload: { name: "BiometricSync", type: "biometric" },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("201 — each integration type is valid", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const app = await buildApp();
    for (const type of ["ehrms", "pfms_payroll", "digilocker", "biometric", "custom"]) {
      const r = await app.inject({
        method: "POST",
        url: "/v1/hrms/integrations",
        headers: auth(),
        payload: { name: `Test ${type}`, type },
      });
      expect(r.statusCode).toBe(201);
    }
    await app.close();
  });

  it("400 — missing name", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(),
      payload: { type: "ehrms" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — empty name", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(),
      payload: { name: "", type: "ehrms" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(),
      payload: { name: "Test" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid type value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(),
      payload: { name: "Test", type: "invalid_type" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      payload: validBody,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(USER, ["employee"]),
      payload: validBody,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — hr_officer cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations",
      headers: auth(USER, ["hr_officer"]),
      payload: validBody,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/integrations/:id/sync (trigger sync) ────────────────────

describe("POST /v1/hrms/integrations/:id/sync", () => {
  it("202 — triggers sync for active integration", async () => {
    // First query: lookup integration, second query: update last_sync_at
    H.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: INT_ID, type: "ehrms", status: "active" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/integrations/${INT_ID}/sync`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.data.id).toBe(INT_ID);
    expect(body.data.syncStatus).toBe("initiated");
    expect(body.data.initiatedAt).toBeDefined();
    await app.close();
  });

  it("400 — invalid UUID in path", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/integrations/not-a-uuid/sync",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/integrations/${INT_ID}/sync`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot sync", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/integrations/${INT_ID}/sync`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — integration not found", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/integrations/${INT_ID}/sync`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("422 — inactive integration cannot sync", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [{ id: INT_ID, type: "ehrms", status: "inactive" }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/integrations/${INT_ID}/sync`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INACTIVE");
    await app.close();
  });
});

// ─── GET /v1/hrms/integrations/:id/history (sync history) ───────────────────

describe("GET /v1/hrms/integrations/:id/history", () => {
  it("200 — returns sync history", async () => {
    H.poolQuery.mockResolvedValue({
      rows: [
        { id: "sh1", status: "completed", records_synced: 150, errors: 0, started_at: "2026-07-01T10:00:00Z", completed_at: "2026-07-01T10:05:00Z" },
      ],
      rowCount: 1,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/integrations/${INT_ID}/history`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].records_synced).toBe(150);
    await app.close();
  });

  it("200 — empty history", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/integrations/${INT_ID}/history`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("400 — invalid UUID in path", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/integrations/bad-id/history",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/integrations/${INT_ID}/history`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot access history", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/integrations/${INT_ID}/history`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot access history", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/integrations/${INT_ID}/history`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
