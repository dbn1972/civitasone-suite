/**
 * Service-book route-level tests — comprehensive coverage:
 * GET  /v1/hrms/employees/:id/service-book
 * POST /v1/hrms/employees/:id/service-book
 * PATCH /v1/hrms/service-book/entries/:entryId
 * POST  /v1/hrms/service-book/entries/:entryId/attest
 *
 * Happy paths, 400 validation, 401 auth, 403 role, 404 not found, 409 conflict.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createMockSqlClient } from "./fixtures/mock-sql-client.js";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER   = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP_ID = "eeeeeeee-1111-4000-8000-000000000001";
const ENTRY_ID = "ffffffff-1111-4000-8000-000000000001";
const DEPT_A = "dddddddd-1111-4000-8000-00000000000a";
const DEPT_B = "dddddddd-1111-4000-8000-00000000000b";

const { listEntriesMock, getEntryMock, attestEntryMock, resolveEmployeeForActorMock, findEmployeeByIdMock } = vi.hoisted(() => ({
  listEntriesMock:  vi.fn(),
  getEntryMock:     vi.fn(),
  attestEntryMock:  vi.fn(),
  resolveEmployeeForActorMock: vi.fn(),
  findEmployeeByIdMock: vi.fn(),
}));

vi.mock("../src/modules/service-book/repo.js", () => ({
  listServiceBookEntries: (...a: unknown[]) => listEntriesMock(...a),
  insertServiceBookEntry: async () => {},
  getEntry:               (...a: unknown[]) => getEntryMock(...a),
  attestEntry:            (...a: unknown[]) => attestEntryMock(...a),
}));

// Dept-scoping fix (GET /v1/hrms/employees/:id/service-book): mocked
// directly rather than reworking this file's bare-object scopedRead mock
// (below) to support the .select().from().where() chain these two actually
// use — same approach medical-routes.test.ts and rti-routes.test.ts take
// for their own repo-level mocks.
vi.mock("../src/modules/employee/actor-link.js", () => ({
  resolveEmployeeForActor: (...a: unknown[]) => resolveEmployeeForActorMock(...a),
  extractActorEmail: () => undefined,
}));
vi.mock("../src/modules/employee/repo.js", () => ({
  findById: (...a: unknown[]) => findEmployeeByIdMock(...a),
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    execute: async () => [],
  },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: createMockSqlClient(),
  sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
}));

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

const ENTRY_ROW = {
  id: ENTRY_ID,
  tenantId: TENANT,
  employeeId: EMP_ID,
  entryType: "promotion",
  effectiveDate: "2026-01-01",
  description: "Promoted to Senior Engineer",
  documentRef: null,
  attested: false,
  attestedBy: null,
  attestedAt: null,
  attestRemarks: null,
  createdAt: new Date("2026-01-02"),
};

beforeEach(() => {
  vi.clearAllMocks();
  listEntriesMock.mockResolvedValue([]);
  getEntryMock.mockResolvedValue(undefined);
  attestEntryMock.mockResolvedValue(ENTRY_ROW);
  // Dept-scoping defaults: manager (USER) and the target employee (EMP_ID)
  // are in the SAME department by default, so every existing manager-role
  // test below keeps its original "200/allowed" expectation unless a test
  // explicitly overrides one of these two mocks.
  resolveEmployeeForActorMock.mockResolvedValue({ id: "manager-emp-row", departmentId: DEPT_A });
  findEmployeeByIdMock.mockResolvedValue({ id: EMP_ID, departmentId: DEPT_A });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── GET /v1/hrms/employees/:id/service-book ────────────────────────────────

describe("GET /v1/hrms/employees/:id/service-book", () => {
  it("200 — returns empty list when no entries", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
    await app.close();
  });

  it("200 — returns service book entries", async () => {
    listEntriesMock.mockResolvedValue([ENTRY_ROW]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].entryType).toBe("promotion");
    await app.close();
  });

  it("400 — invalid employee UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees/not-a-uuid/service-book",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role is rejected", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — manager role is allowed for an employee in the manager's OWN department", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  // ── Dept-scoping regression (SEC finding: manager access had no
  // department scope, tenant-wide by employee-id enumeration) ───────────
  it("403 — manager CANNOT read service-book for an employee in a DIFFERENT department", async () => {
    resolveEmployeeForActorMock.mockResolvedValue({ id: "manager-emp-row", departmentId: DEPT_A });
    findEmployeeByIdMock.mockResolvedValue({ id: EMP_ID, departmentId: DEPT_B });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
    expect(listEntriesMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("403 — manager with NO linked employee record (fails closed, not tenant-wide)", async () => {
    resolveEmployeeForActorMock.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NO_EMPLOYEE_LINK");
    await app.close();
  });

  it("403 — manager querying a nonexistent employee id gets FORBIDDEN, not a 200 with empty data", async () => {
    findEmployeeByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — HR role reads across departments unrestricted (never resolves an actor-employee link)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: auth(), // default hr_admin
    });
    expect(r.statusCode).toBe(200);
    expect(resolveEmployeeForActorMock).not.toHaveBeenCalled();
    expect(findEmployeeByIdMock).not.toHaveBeenCalled();
    await app.close();
  });
});

// ─── POST /v1/hrms/employees/:id/service-book ───────────────────────────────

describe("POST /v1/hrms/employees/:id/service-book", () => {
  const validBody = {
    entryType: "promotion",
    effectiveDate: "2026-01-01",
    description: "Promoted to Senior Engineer",
  };

  it("202 — accepted with entry id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: validBody,
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body).toHaveProperty("id");
    expect(body.status).toBe("accepted");
    await app.close();
  });

  it("400 — missing entryType", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { effectiveDate: "2026-01-01", description: "Test" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — empty description", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { ...validBody, description: "" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      payload: validBody,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager role cannot write service book", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/service-book`,
      headers: { ...auth(USER, ["manager"]), "content-type": "application/json" },
      payload: validBody,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── PATCH /v1/hrms/service-book/entries/:entryId ───────────────────────────

describe("PATCH /v1/hrms/service-book/entries/:entryId", () => {
  it("202 — updates an unattested entry", async () => {
    getEntryMock.mockResolvedValue({ ...ENTRY_ROW, attested: false });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { description: "Updated description" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().updated).toBe(true);
    await app.close();
  });

  it("404 — entry not found", async () => {
    getEntryMock.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { description: "Updated description" },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("409 — cannot edit attested entry", async () => {
    getEntryMock.mockResolvedValue({ ...ENTRY_ROW, attested: true });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { description: "Updated description" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ATTESTED_IMMUTABLE");
    await app.close();
  });

  it("400 — empty description rejected", async () => {
    getEntryMock.mockResolvedValue({ ...ENTRY_ROW, attested: false });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { description: "" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}`,
      payload: { description: "Test" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ─── POST /v1/hrms/service-book/entries/:entryId/attest ─────────────────────

describe("POST /v1/hrms/service-book/entries/:entryId/attest", () => {
  it("202 — attests an unattested entry", async () => {
    getEntryMock.mockResolvedValue({ ...ENTRY_ROW, attested: false });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}/attest`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { remarks: "Verified and attested" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.attested).toBe(true);
    expect(body.id).toBe(ENTRY_ID);
    await app.close();
  });

  it("202 — attest without remarks", async () => {
    getEntryMock.mockResolvedValue({ ...ENTRY_ROW, attested: false });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}/attest`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: {},
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("404 — entry not found", async () => {
    getEntryMock.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}/attest`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: {},
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — already attested", async () => {
    getEntryMock.mockResolvedValue({ ...ENTRY_ROW, attested: true });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}/attest`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ALREADY_ATTESTED");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}/attest`,
      payload: {},
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager cannot attest", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/service-book/entries/${ENTRY_ID}/attest`,
      headers: { ...auth(USER, ["manager"]), "content-type": "application/json" },
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
