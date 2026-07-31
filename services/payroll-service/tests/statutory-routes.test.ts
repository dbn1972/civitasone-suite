/**
 * payroll-service — Statutory routes integration tests
 *
 * Covers all 6 statutory report endpoints:
 * - GET /v1/payroll/statutory/pf
 * - GET /v1/payroll/statutory/esi
 * - GET /v1/payroll/statutory/tds
 * - GET /v1/payroll/statutory/gratuity
 * - GET /v1/payroll/statutory/gpf
 * - GET /v1/payroll/statutory/nps
 *
 * Tests: happy path (200), 401 unauthenticated, 403 forbidden
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const USER_ID = "aaaaaaaa-bbbb-4000-8000-000000000077";

const H = vi.hoisted(() => ({
  listPfMock: vi.fn(),
  listEsiMock: vi.fn(),
  listTdsMock: vi.fn(),
  listGratuityMock: vi.fn(),
  listGpfMock: vi.fn(),
  listNpsMock: vi.fn(),
}));

vi.mock("../src/modules/statutory/repo.js", () => ({
  listPfByTenant: (...a: unknown[]) => H.listPfMock(...a),
  listEsiByTenant: (...a: unknown[]) => H.listEsiMock(...a),
  listTdsByTenant: (...a: unknown[]) => H.listTdsMock(...a),
  listGratuityByTenant: (...a: unknown[]) => H.listGratuityMock(...a),
  listGpfByTenant: (...a: unknown[]) => H.listGpfMock(...a),
  listNpsByTenant: (...a: unknown[]) => H.listNpsMock(...a),
}));

vi.mock("../src/shared/infra.js", async (io) => {
  const actual = await io<Record<string, unknown>>();
  return {
    ...actual,
    cache: {
      getOrLoad: async (_key: string, loader: () => Promise<unknown>) => loader(),
      invalidate: async () => undefined,
      makeKey: (...parts: string[]) => parts.join(":"),
    },
    queue: { publish: async () => undefined, subscribe: () => undefined, start: async () => undefined, stop: async () => undefined },
  };
});

vi.mock("../src/shared/outbox.js", async (io) => {
  const actual = await io<Record<string, unknown>>();
  return {
    ...actual,
    enqueue: vi.fn(async () => undefined),
    markProcessed: vi.fn(async () => undefined),
  };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

function adminToken(roles = ["payroll_admin"]) {
  return signToken({ sub: USER_ID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

// Sample data for mocked repo functions
const pfRow = { id: "pf-1", employeeId: "emp-1", period: "2025-03", basicMinor: 5000000n, empContribMinor: 600000n, erContribMinor: 600000n };
const esiRow = { id: "esi-1", employeeId: "emp-1", period: "2025-03", grossMinor: 1500000n, empContribMinor: 11250n, erContribMinor: 48750n };
const tdsRow = { id: "tds-1", employeeId: "emp-1", period: "2025-03", taxableMinor: 8000000n, tdsMinor: 400000n };
const gratuityRow = { id: "grat-1", employeeId: "emp-1", yearsOfService: 10, gratuityMinor: 2000000n, status: "eligible" };
const gpfRow = { id: "gpf-1", employeeId: "emp-1", period: "2025-03", basicMinor: 5000000n, contribPct: 10, empContribMinor: 500000n };
const npsRow = { id: "nps-1", employeeId: "emp-1", period: "2025-03", basicMinor: 5000000n, empContribPct: 10, erContribPct: 14, empContribMinor: 500000n, erContribMinor: 700000n };

beforeEach(() => {
  vi.clearAllMocks();
  H.listPfMock.mockResolvedValue([pfRow]);
  H.listEsiMock.mockResolvedValue([esiRow]);
  H.listTdsMock.mockResolvedValue([tdsRow]);
  H.listGratuityMock.mockResolvedValue([gratuityRow]);
  H.listGpfMock.mockResolvedValue([gpfRow]);
  H.listNpsMock.mockResolvedValue([npsRow]);
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/pf
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/pf", () => {
  it("200 — returns PF report for authorized user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({
      id: "pf-1",
      employeeId: "emp-1",
      period: "2025-03",
    });
  });

  it("200 — respects limit query param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf?limit=5",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(H.listPfMock).toHaveBeenCalledWith(TENANT, 5);
  });

  it("200 — hr_admin role can access", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("200 — finance_officer role can access", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["finance_officer"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role forbidden", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("403 — employee role forbidden", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/esi
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/esi", () => {
  it("200 — returns ESI report", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ id: "esi-1", employeeId: "emp-1" });
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("403 — unauthorized role", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/tds
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/tds", () => {
  it("200 — returns TDS report", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]).toMatchObject({ id: "tds-1", employeeId: "emp-1" });
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("403 — unauthorized role", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/gratuity
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/gratuity", () => {
  it("200 — returns gratuity report", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]).toMatchObject({ id: "grat-1", status: "eligible" });
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("403 — unauthorized role", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/gpf
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/gpf", () => {
  it("200 — returns GPF report", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]).toMatchObject({ id: "gpf-1", contribPct: 10 });
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("403 — unauthorized role", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/nps
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/nps", () => {
  it("200 — returns NPS report", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]).toMatchObject({ id: "nps-1", empContribPct: 10, erContribPct: 14 });
  });

  it("200 — returns empty array when no data", async () => {
    H.listNpsMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("403 — unauthorized role", async () => {
    const token = signToken({ sub: USER_ID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});
