/**
 * Route-level tests for the Contracts module (Task 9.x):
 * - CRUD: create, activate, list, get, terminate
 * - Renewals: initiate, bulk, list, get
 * - Dashboard: expiring contracts
 * - Config: get, patch
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const CONTRACT_ID = "cccccccc-0001-4000-8000-000000000001";
const EMP_ID = "eeeeeeee-0001-4000-8000-000000000001";
const RENEWAL_ID = "aaaaaaaa-0002-4000-8000-000000000002";

// --- Mock setup ---
const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          offset: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({
            limit: (n: unknown) => ({
              offset: (n2: unknown) => H.selectFrom(...args, ...w),
              then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
                Promise.resolve(H.selectFrom(...args, ...w)).then(resolve, reject),
            }),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
              Promise.resolve(H.selectFrom(...args, ...w)).then(resolve, reject),
          }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({
        limit: (n: unknown) => ({
          offset: (n2: unknown) => H.selectFrom(...args),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(H.selectFrom(...args)).then(resolve, reject),
        }),
      }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({
      values: (v: unknown) => ({
        ...H.insert(v),
        onConflictDoUpdate: (opts: unknown) => ({
          returning: () => H.insert(v),
        }),
      }),
    }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: {
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
        if (H.transaction.getMockImplementation()) return H.transaction(cb);
        return cb(mockTx);
      },
    },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const validCreateBody = {
  employeeId: EMP_ID,
  startDate: "2026-01-01",
  endDate: "2027-01-01",
  terms: {
    role: "Software Engineer",
    compensationMinor: "5000000",
    currency: "INR",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([]);
  H.update.mockResolvedValue(undefined);
  H.insert.mockResolvedValue([{ id: CONTRACT_ID, tenantId: TENANT, status: "draft" }]);
  H.execute.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 9.1 — Contract CRUD
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/hrms/contracts (create)", () => {
  it("creates a contract (202)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts",
      headers: auth(),
      payload: validCreateBody,
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
    await app.close();
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts",
      headers: auth(),
      payload: { employeeId: EMP_ID },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 for invalid date format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts",
      headers: auth(),
      payload: { ...validCreateBody, startDate: "01-01-2026" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid employeeId (not UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts",
      headers: auth(),
      payload: { ...validCreateBody, employeeId: "not-a-uuid" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts",
      payload: validCreateBody,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for non-HR role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts",
      headers: auth(USER, ["employee"]),
      payload: validCreateBody,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/contracts/:id/activate", () => {
  it("activates a contract (202)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/activate`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("returns 400 for missing version", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/activate`,
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid id param (not UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts/not-a-uuid/activate",
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/activate`,
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for manager role (HR only)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/activate`,
      headers: auth(USER, ["manager"]),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contracts (list)", () => {
  it("returns paginated contracts (200)", async () => {
    H.selectFrom.mockResolvedValue([
      { id: CONTRACT_ID, employeeId: EMP_ID, status: "active", startDate: "2026-01-01", endDate: "2027-01-01" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts?limit=10&offset=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toBeDefined();
    await app.close();
  });

  it("accepts employeeId and status filters", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts?employeeId=${EMP_ID}&status=active`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("allows manager role to list", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts",
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contracts/:id (get by ID)", () => {
  it("returns contract when found (200)", async () => {
    H.selectFrom.mockResolvedValue([
      { id: CONTRACT_ID, tenantId: TENANT, employeeId: EMP_ID, status: "active", startDate: "2026-01-01", endDate: "2027-01-01" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/${CONTRACT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(CONTRACT_ID);
    await app.close();
  });

  it("returns 404 when contract not found", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/${CONTRACT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("CONTRACT_NOT_FOUND");
    await app.close();
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/not-a-uuid",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/${CONTRACT_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/${CONTRACT_ID}`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contracts/employee/:employeeId/history", () => {
  it("returns contract history (200)", async () => {
    H.selectFrom.mockResolvedValue([
      { id: CONTRACT_ID, employeeId: EMP_ID, status: "expired", startDate: "2024-01-01", endDate: "2025-01-01" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/employee/${EMP_ID}/history`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeInstanceOf(Array);
    await app.close();
  });

  it("returns empty array for employee with no contracts", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/employee/${EMP_ID}/history`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("returns 400 for invalid employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/employee/not-a-uuid/history",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/employee/${EMP_ID}/history`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/employee/${EMP_ID}/history`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/contracts/:id/terminate", () => {
  it("terminates a contract (202)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/terminate`,
      headers: auth(),
      payload: { version: 1, reason: "Employee resigned" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("returns 400 for missing reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/terminate`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for missing version", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/terminate`,
      headers: auth(),
      payload: { reason: "Employee resigned" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/terminate`,
      payload: { version: 1, reason: "left" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for manager role (HR only)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/terminate`,
      headers: auth(USER, ["manager"]),
      payload: { version: 1, reason: "left" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 9.2 — Renewals
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/hrms/contracts/:id/renew", () => {
  it("initiates renewal for active contract (202)", async () => {
    // Each scopedRead chain calls H.selectFrom twice (where + limit), so we need 4 values:
    // getContractById: 2 calls, getPendingRenewalForContract: 2 calls
    const contract = [{ id: CONTRACT_ID, tenantId: TENANT, status: "active", endDate: "2027-01-01" }];
    H.selectFrom
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(),
      payload: { newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("initiates renewal for expiring contract (202)", async () => {
    const contract = [{ id: CONTRACT_ID, tenantId: TENANT, status: "expiring", endDate: "2027-01-01" }];
    H.selectFrom
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(),
      payload: { newEndDate: "2028-01-01", reason: "Good performance" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("returns 404 when contract not found", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(),
      payload: { newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("CONTRACT_NOT_FOUND");
    await app.close();
  });

  it("returns 422 for contract in wrong status (draft)", async () => {
    const contract = [{ id: CONTRACT_ID, tenantId: TENANT, status: "draft", endDate: "2027-01-01" }];
    H.selectFrom
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce(contract);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(),
      payload: { newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_CONTRACT_STATUS");
    await app.close();
  });

  it("returns 409 when pending renewal already exists", async () => {
    const contract = [{ id: CONTRACT_ID, tenantId: TENANT, status: "active", endDate: "2027-01-01" }];
    const pending = [{ id: RENEWAL_ID, status: "pending_approval" }];
    H.selectFrom
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(),
      payload: { newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("RENEWAL_IN_PROGRESS");
    await app.close();
  });

  it("returns 400 for missing newEndDate", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid date format in newEndDate", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(),
      payload: { newEndDate: "January 2028" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      payload: { newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(USER, ["employee"]),
      payload: { newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("allows manager role to initiate renewal", async () => {
    const contract = [{ id: CONTRACT_ID, tenantId: TENANT, status: "active", endDate: "2027-01-01" }];
    H.selectFrom
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce(contract)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/contracts/${CONTRACT_ID}/renew`,
      headers: auth(USER, ["manager"]),
      payload: { newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });
});

describe("POST /v1/hrms/contracts/bulk-renew", () => {
  it("submits bulk renewal (202)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts/bulk-renew",
      headers: auth(),
      payload: {
        contractIds: [CONTRACT_ID],
        newEndDate: "2028-01-01",
        reason: "Annual renewal",
      },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("returns 400 for empty contractIds array", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts/bulk-renew",
      headers: auth(),
      payload: { contractIds: [], newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid UUID in contractIds", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts/bulk-renew",
      headers: auth(),
      payload: { contractIds: ["not-uuid"], newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts/bulk-renew",
      payload: { contractIds: [CONTRACT_ID], newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for manager role (HR only)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/contracts/bulk-renew",
      headers: auth(USER, ["manager"]),
      payload: { contractIds: [CONTRACT_ID], newEndDate: "2028-01-01" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contracts/renewals (list renewals)", () => {
  it("returns paginated renewals (200)", async () => {
    H.selectFrom.mockResolvedValue([
      { id: RENEWAL_ID, contractId: CONTRACT_ID, status: "pending_approval" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/renewals?limit=10&offset=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toBeDefined();
    await app.close();
  });

  it("accepts contractId filter", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/renewals?contractId=${CONTRACT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/renewals",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/renewals",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contracts/renewals/:id", () => {
  it("returns renewal when found (200)", async () => {
    H.selectFrom.mockResolvedValue([
      { id: RENEWAL_ID, tenantId: TENANT, contractId: CONTRACT_ID, status: "pending_approval" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/renewals/${RENEWAL_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(RENEWAL_ID);
    await app.close();
  });

  it("returns 404 when renewal not found", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/renewals/${RENEWAL_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("RENEWAL_NOT_FOUND");
    await app.close();
  });

  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/renewals/not-a-uuid",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/contracts/renewals/${RENEWAL_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 9.3 — Dashboard and Config
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/contracts/dashboard/expiring", () => {
  it("returns enriched expiring contracts (200)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    H.selectFrom.mockResolvedValue([
      { id: CONTRACT_ID, employeeId: EMP_ID, status: "expiring", endDate: today, startDate: "2026-01-01" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/dashboard/expiring",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toBeInstanceOf(Array);
    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty("daysRemaining");
      expect(body.data[0]).toHaveProperty("renewalStatus");
    }
    await app.close();
  });

  it("returns empty data when no expiring contracts", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/dashboard/expiring",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/dashboard/expiring",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for manager role (HR only)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/dashboard/expiring",
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contracts/config", () => {
  it("returns config when found (200)", async () => {
    H.selectFrom.mockResolvedValue([
      { tenantId: TENANT, reminderMilestones: [30, 60, 90], autoSeparationEnabled: false, version: 1 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/config",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("returns null data when no config exists", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/config",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeNull();
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/config",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contracts/config",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("PATCH /v1/hrms/contracts/config", () => {
  it("upserts config (200)", async () => {
    H.insert.mockResolvedValue([
      { tenantId: TENANT, reminderMilestones: [30, 60], autoSeparationEnabled: true, version: 1 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/v1/hrms/contracts/config",
      headers: auth(),
      payload: { reminderMilestones: [30, 60], autoSeparationEnabled: true },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("updates scheduler time (200)", async () => {
    H.insert.mockResolvedValue([
      { tenantId: TENANT, schedulerTimeUtc: "06:00", version: 2 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/v1/hrms/contracts/config",
      headers: auth(),
      payload: { schedulerTimeUtc: "06:00" },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("updates approval chain (200)", async () => {
    H.insert.mockResolvedValue([
      { tenantId: TENANT, approvalChain: [{ role: "hr_admin" }], version: 2 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/v1/hrms/contracts/config",
      headers: auth(),
      payload: { approvalChain: [{ role: "hr_admin" }] },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 for invalid reminderMilestones (too large)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/v1/hrms/contracts/config",
      headers: auth(),
      payload: { reminderMilestones: [999] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid schedulerTimeUtc format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/v1/hrms/contracts/config",
      headers: auth(),
      payload: { schedulerTimeUtc: "6am" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/v1/hrms/contracts/config",
      payload: { autoSeparationEnabled: true },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for manager role (HR only)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/v1/hrms/contracts/config",
      headers: auth(USER, ["manager"]),
      payload: { autoSeparationEnabled: true },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
