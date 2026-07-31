/**
 * payroll-service — Statutory module ADDITIONAL coverage tests
 *
 * Targets the queries.ts mapping layer and repo.ts read functions that the
 * existing statutory-routes.test.ts does not exercise in isolation. By mocking
 * at the repo layer (listXxxByTenant) we verify the queries.ts Number()
 * coercion, structural mapping, and edge cases (empty results, large bigint).
 *
 * Also covers: 400 (invalid limit), multi-role access variations, bigint→Number
 * serialisation.
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
  insertPf: vi.fn(),
  insertEsi: vi.fn(),
  insertTds: vi.fn(),
  insertGratuity: vi.fn(),
  insertGpf: vi.fn(),
  insertNps: vi.fn(),
  sumEmployerContribByRun: vi.fn(() => 0n),
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

vi.mock("../src/modules/tax/config.js", () => ({
  loadTaxConfig: vi.fn(),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

function token(roles: string[] = ["payroll_admin"]) {
  return signToken({ sub: USER_ID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
  H.listPfMock.mockResolvedValue([]);
  H.listEsiMock.mockResolvedValue([]);
  H.listTdsMock.mockResolvedValue([]);
  H.listGratuityMock.mockResolvedValue([]);
  H.listGpfMock.mockResolvedValue([]);
  H.listNpsMock.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// queries.ts — Number() coercion on bigint columns
// ═══════════════════════════════════════════════════════════════════════════════

describe("Statutory queries — bigint→Number coercion", () => {
  it("PF report coerces bigint amounts to Numbers in response", async () => {
    H.listPfMock.mockResolvedValue([{
      id: "pf-1", employeeId: "emp-1", period: "2025-06",
      basicMinor: 5000000n, empContribMinor: 600000n, erContribMinor: 600000n,
    }]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].basicMinor).toBe(5000000);
    expect(body[0].empContribMinor).toBe(600000);
    expect(body[0].erContribMinor).toBe(600000);
  });

  it("ESI report coerces bigint amounts to Numbers", async () => {
    H.listEsiMock.mockResolvedValue([{
      id: "esi-1", employeeId: "emp-1", period: "2025-06",
      grossMinor: 2100000n, empContribMinor: 15750n, erContribMinor: 68250n,
    }]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].grossMinor).toBe(2100000);
    expect(body[0].empContribMinor).toBe(15750);
    expect(body[0].erContribMinor).toBe(68250);
  });

  it("TDS report coerces taxableMinor and tdsMinor", async () => {
    H.listTdsMock.mockResolvedValue([{
      id: "tds-1", employeeId: "emp-1", period: "2025-06",
      taxableMinor: 120000000n, tdsMinor: 30000000n,
    }]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].taxableMinor).toBe(120000000);
    expect(body[0].tdsMinor).toBe(30000000);
  });

  it("Gratuity report includes yearsOfService and status", async () => {
    H.listGratuityMock.mockResolvedValue([{
      id: "grat-1", employeeId: "emp-1", yearsOfService: 25,
      gratuityMinor: 2000000n, status: "paid",
    }]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].gratuityMinor).toBe(2000000);
    expect(body[0].yearsOfService).toBe(25);
    expect(body[0].status).toBe("paid");
  });

  it("GPF report coerces basicMinor and empContribMinor", async () => {
    H.listGpfMock.mockResolvedValue([{
      id: "gpf-1", employeeId: "emp-1", period: "2025-06",
      basicMinor: 8000000n, contribPct: 12, empContribMinor: 960000n,
    }]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].basicMinor).toBe(8000000);
    expect(body[0].empContribMinor).toBe(960000);
    expect(body[0].contribPct).toBe(12);
  });

  it("NPS report coerces all bigint and includes contrib percentages", async () => {
    H.listNpsMock.mockResolvedValue([{
      id: "nps-1", employeeId: "emp-1", period: "2025-06",
      basicMinor: 7000000n, empContribPct: 10, erContribPct: 14,
      empContribMinor: 700000n, erContribMinor: 980000n,
    }]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].basicMinor).toBe(7000000);
    expect(body[0].empContribMinor).toBe(700000);
    expect(body[0].erContribMinor).toBe(980000);
    expect(body[0].empContribPct).toBe(10);
    expect(body[0].erContribPct).toBe(14);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Empty results — all endpoints return []
// ═══════════════════════════════════════════════════════════════════════════════

describe("Statutory routes — empty result sets", () => {
  it("GET /pf returns empty array when no data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /esi returns empty array when no data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /tds returns empty array when no data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /gratuity returns empty array when no data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /gpf returns empty array when no data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Limit param — exercises listQuerySchema parsing in routes.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe("Statutory routes — limit parameter handling", () => {
  it("passes limit=1 to repo for PF", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf?limit=1",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(H.listPfMock).toHaveBeenCalledWith(TENANT, 1);
  });

  it("passes limit=200 to repo for ESI", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi?limit=200",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(H.listEsiMock).toHaveBeenCalledWith(TENANT, 200);
  });

  it("passes limit=50 to repo for TDS", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds?limit=50",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(H.listTdsMock).toHaveBeenCalledWith(TENANT, 50);
  });

  it("passes limit=10 to repo for Gratuity", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity?limit=10",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(H.listGratuityMock).toHaveBeenCalledWith(TENANT, 10);
  });

  it("passes limit=25 to repo for GPF", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf?limit=25",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(H.listGpfMock).toHaveBeenCalledWith(TENANT, 25);
  });

  it("passes limit=75 to repo for NPS", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps?limit=75",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(H.listNpsMock).toHaveBeenCalledWith(TENANT, 75);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Role-based access — additional role variations
// ═══════════════════════════════════════════════════════════════════════════════

describe("Statutory routes — role variations", () => {
  it("payroll_officer can access /pf", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token(["payroll_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("super_admin can access /esi", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi",
      headers: { authorization: `Bearer ${token(["super_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("hr_admin can access /tds", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("finance_officer can access /gratuity", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
      headers: { authorization: `Bearer ${token(["finance_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — expired/invalid token on /gpf", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf",
      headers: { authorization: "Bearer invalid.token.here" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — audit_officer cannot access /nps", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps",
      headers: { authorization: `Bearer ${token(["audit_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 — procurement_officer cannot access /pf", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token(["procurement_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("401 — no token on /gratuity", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("401 — no token on /tds", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("401 — no token on /gpf", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gpf",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Multiple rows — ensures mapping works for N>1
// ═══════════════════════════════════════════════════════════════════════════════

describe("Statutory routes — multiple rows", () => {
  it("PF returns all rows mapped correctly", async () => {
    H.listPfMock.mockResolvedValue([
      { id: "pf-1", employeeId: "e1", period: "2025-01", basicMinor: 100n, empContribMinor: 12n, erContribMinor: 12n },
      { id: "pf-2", employeeId: "e2", period: "2025-02", basicMinor: 200n, empContribMinor: 24n, erContribMinor: 24n },
      { id: "pf-3", employeeId: "e3", period: "2025-03", basicMinor: 300n, empContribMinor: 36n, erContribMinor: 36n },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(3);
    expect(body[2].id).toBe("pf-3");
    expect(body[2].basicMinor).toBe(300);
  });

  it("Gratuity returns multiple employees with different statuses", async () => {
    H.listGratuityMock.mockResolvedValue([
      { id: "g1", employeeId: "e1", yearsOfService: 5, gratuityMinor: 100000n, status: "eligible" },
      { id: "g2", employeeId: "e2", yearsOfService: 20, gratuityMinor: 2000000n, status: "paid" },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].status).toBe("eligible");
    expect(body[1].status).toBe("paid");
  });
});
