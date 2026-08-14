/**
 * OrgChart route-level tests — comprehensive coverage:
 * happy paths, 401 unauthenticated, 403 forbidden.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER   = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP_A  = "eeeeeeee-aaaa-4000-8000-000000000001";
const EMP_B  = "eeeeeeee-bbbb-4000-8000-000000000002";

const { listByTenantMock } = vi.hoisted(() => ({
  listByTenantMock: vi.fn(),
}));

vi.mock("../src/modules/employee/repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listByTenant: (...a: unknown[]) => listByTenantMock(...a),
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    execute: async () => [],
  },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
  sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
    listKey: (...a: string[]) => a.join(":"),
    // listOrLoad calls the loader directly so org chart tree is built live
    listOrLoad: async (_t: string, _ns: string, _k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function makeEmp(id: string, managerId?: string) {
  return {
    id,
    fullName: `Employee ${id.slice(0, 8)}`,
    employeeNo: `EMP-${id.slice(0, 4)}`,
    departmentId: "dddddddd-0001-4000-8000-000000000001",
    designationId: "dddddddd-0002-4000-8000-000000000002",
    status: "active",
    managerId: managerId ?? null,
    email: `emp${id.slice(0, 4)}@test.gov.in`,
    dateOfJoining: "2025-01-01",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listByTenantMock.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── GET /v1/hrms/org-chart ─────────────────────────────────────────────────

describe("GET /v1/hrms/org-chart", () => {
  it("200 — returns empty array when no employees", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json())).toBe(true);
    expect(r.json()).toHaveLength(0);
    await app.close();
  });

  it("200 — root nodes have no manager, child nodes are nested", async () => {
    listByTenantMock.mockResolvedValue([
      makeEmp(EMP_A),           // root
      makeEmp(EMP_B, EMP_A),    // child of EMP_A
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const nodes = r.json();
    expect(nodes).toHaveLength(1); // only one root
    expect(nodes[0].id).toBe(EMP_A);
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].id).toBe(EMP_B);
    await app.close();
  });

  it("200 — separated employees are excluded from tree", async () => {
    listByTenantMock.mockResolvedValue([
      makeEmp(EMP_A),
      { ...makeEmp(EMP_B), status: "separated" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const nodes = r.json();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe(EMP_A);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/org-chart" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role is rejected", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — manager role is allowed", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
