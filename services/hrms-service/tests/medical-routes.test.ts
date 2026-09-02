/**
 * Medical Claims module route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all medical claim endpoints.
 *
 * Endpoints under test:
 *  POST   /v1/hrms/medical/claims            — submit medical claim
 *  GET    /v1/hrms/medical/claims            — list claims
 *  PATCH  /v1/hrms/medical/claims/:id/approve — HR approves/rejects
 *  GET    /v1/hrms/medical/hospitals         — empanelled hospital list
 *  GET    /v1/hrms/medical/insurance         — insurance details
 *  GET    /v1/hrms/medical/history           — medical history timeline
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const CLAIM_ID = "cccccccc-0001-4000-8000-000000000001";
const HOSPITAL_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  sqlClientQuery: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
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
  // sqlClient is used as a tagged template literal in medical routes.
  // Mock it as a callable function that returns query results.
  const sqlClientFn = (...args: unknown[]) => H.sqlClientQuery(...args);
  sqlClientFn.end = async () => {};
  sqlClientFn.unsafe = async () => [];
  sqlClientFn.begin = async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => {
    // withRawTenantGuc's first statement inside the transaction is always
    // `tx`SELECT set_config('app.tenant_id', ...)`` — that internal
    // bookkeeping call must not consume a mockReturnValueOnce() queued for
    // the caller's own query, or every "Once"-based test shifts by one call.
    const tx = ((...args: unknown[]) => {
      const [strings] = args as [TemplateStringsArray];
      if (strings?.[0]?.includes("set_config")) return Promise.resolve([]);
      return H.sqlClientQuery(...args);
    }) as typeof sqlClientFn;
    return fn(tx);
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: sqlClientFn,
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

const claimRow = (over: Record<string, unknown> = {}) => ({
  id: CLAIM_ID, employee_id: EMP, claim_type: "OPD",
  amount_minor: "50000", hospital_name: "AIIMS",
  hospital_id: HOSPITAL_ID, diagnosis: "Fever",
  documents: "[]", status: "pending",
  dependant_name: null, dependant_relation: null,
  approved_amount_minor: null, remarks: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const hospitalRow = (over: Record<string, unknown> = {}) => ({
  id: HOSPITAL_ID, name: "AIIMS Delhi", city: "Delhi",
  state: "Delhi", type: "government",
  empanelment_expiry: "2027-12-31", specialities: "General",
  ...over,
});

const insuranceRow = (over: Record<string, unknown> = {}) => ({
  employee_id: EMP, scheme_type: "CGHS", scheme_id: "CGHS-001",
  card_number: "CGHS-CARD-001", validity_from: "2025-01-01",
  validity_to: "2027-12-31", tier: "S-1",
  dependants: 3, annual_limit_minor: "500000",
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  // Default: sqlClient tagged template returns empty array
  H.sqlClientQuery.mockReturnValue([]);
  H.selectFrom.mockResolvedValue([]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue({ rowCount: 1 });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await (sqlClient as unknown as { end: () => Promise<void> }).end();
});

// =================== POST /v1/hrms/medical/claims ===================
describe("POST /v1/hrms/medical/claims — submit medical claim", () => {
  const payload = {
    employeeId: EMP,
    claimType: "outdoor",
    amountMinor: 50000,
    hospitalName: "AIIMS Delhi",
    hospitalId: HOSPITAL_ID,
    diagnosis: "Seasonal fever and viral infection",
    documents: ["https://docs.example.com/receipt.pdf"],
    dependantName: "Spouse",
    dependantRelation: "spouse",
    remarks: "urgent treatment needed",
  };

  it("creates a medical claim (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.data.employeeId).toBe(EMP);
    expect(body.data.status).toBe("pending");
    expect(body.data.amountMinor).toBe(50000);
    expect(body.data.id).toBeDefined();
    await app.close();
  });

  it("employees can submit their own claims (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("managers can submit claims (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(USER, ["manager"]), payload });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("returns 400 on missing required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { employeeId: EMP } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on invalid employeeId (not UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, employeeId: "not-a-uuid" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on invalid claimType", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, claimType: "surgery" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on zero amountMinor", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, amountMinor: 0 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on negative amountMinor", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, amountMinor: -100 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on empty hospitalName", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, hospitalName: "" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on empty diagnosis", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, diagnosis: "" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(USER, ["audit_officer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("accepts optional fields being omitted (201)", async () => {
    const minimal = {
      employeeId: EMP,
      claimType: "indoor",
      amountMinor: 100000,
      hospitalName: "Max Hospital",
      diagnosis: "Appendectomy",
    };
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: minimal });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("pending");
    await app.close();
  });

  it("accepts all claimType variants (reimbursement)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, claimType: "reimbursement" } });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("accepts all claimType variants (advance)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: auth(), payload: { ...payload, claimType: "advance" } });
    expect(r.statusCode).toBe(201);
    await app.close();
  });
});

// =================== GET /v1/hrms/medical/claims ===================
describe("GET /v1/hrms/medical/claims — list claims", () => {
  it("lists claims (200)", async () => {
    H.sqlClientQuery.mockReturnValue([claimRow(), claimRow({ id: "cccccccc-0002-4000-8000-000000000002" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    await app.close();
  });

  it("filters by employeeId (200)", async () => {
    H.sqlClientQuery.mockReturnValue([claimRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/claims?employeeId=${EMP}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("filters by status (200)", async () => {
    H.sqlClientQuery.mockReturnValue([claimRow({ status: "approved" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims?status=approved", headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns empty array when no claims (200)", async () => {
    H.sqlClientQuery.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("returns 400 on invalid employeeId format", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims?employeeId=not-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on invalid status value", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims?status=unknown", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on limit exceeding max", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims?limit=200", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims", headers: auth(USER, ["audit_officer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("employees can list their own claims (200)", async () => {
    H.sqlClientQuery.mockReturnValue([claimRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/claims?employeeId=${EMP}`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

// =================== PATCH /v1/hrms/medical/claims/:id/approve ===================
describe("PATCH /v1/hrms/medical/claims/:id/approve — HR approve/reject", () => {
  it("approves a pending claim (200)", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "pending", amount_minor: "50000" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "approved", approvedAmountMinor: 45000 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(CLAIM_ID);
    expect(r.json().data.status).toBe("approved");
    expect(r.json().data.approvedAmountMinor).toBe(45000);
    await app.close();
  });

  it("approves without specifying amount — defaults to claim amount (200)", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "pending", amount_minor: "75000" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.approvedAmountMinor).toBe(75000);
    await app.close();
  });

  it("rejects a pending claim (200)", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "pending" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "rejected", remarks: "insufficient documentation" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("rejected");
    expect(r.json().data.approvedAmountMinor).toBe(0);
    await app.close();
  });

  it("finance_officer can approve (200)", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "pending", amount_minor: "50000" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(USER, ["finance_officer"]), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 on invalid status value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "cancelled" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on invalid claim ID (not UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/medical/claims/bad-id/approve",
      headers: auth(), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 when body is empty", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role (not HR)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(USER, ["employee"]), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 403 for manager role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(USER, ["manager"]), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when claim not found", async () => {
    H.sqlClientQuery.mockReturnValueOnce([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 409 when claim is already approved", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "approved" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "rejected" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 409 when claim is already rejected", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "rejected" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 409 when claim is in paid state", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "paid" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(), payload: { status: "approved" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});

// =================== GET /v1/hrms/medical/hospitals ===================
describe("GET /v1/hrms/medical/hospitals — empanelled hospital list", () => {
  it("lists hospitals (200)", async () => {
    H.sqlClientQuery.mockReturnValue([hospitalRow(), hospitalRow({ id: "dddddddd-0002-4000-8000-000000000002", name: "Safdarjung" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    await app.close();
  });

  it("filters by city (200)", async () => {
    H.sqlClientQuery.mockReturnValue([hospitalRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals?city=Delhi", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("returns empty array when no hospitals (200)", async () => {
    H.sqlClientQuery.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("respects custom limit param (200)", async () => {
    H.sqlClientQuery.mockReturnValue([hospitalRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals?limit=10", headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 on limit exceeding max (200+)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals?limit=300", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals", headers: auth(USER, ["audit_officer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("employees can view hospitals (200)", async () => {
    H.sqlClientQuery.mockReturnValue([hospitalRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/hospitals", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

// =================== GET /v1/hrms/medical/insurance ===================
describe("GET /v1/hrms/medical/insurance — insurance details", () => {
  it("returns insurance details (200)", async () => {
    H.sqlClientQuery.mockReturnValue([insuranceRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/insurance?employeeId=${EMP}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.employee_id).toBe(EMP);
    expect(r.json().data.scheme_type).toBe("CGHS");
    await app.close();
  });

  it("returns 400 when employeeId is missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/insurance", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 when employeeId is not a UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/insurance?employeeId=bad", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/insurance?employeeId=${EMP}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/insurance?employeeId=${EMP}`, headers: auth(USER, ["audit_officer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when no insurance record found", async () => {
    H.sqlClientQuery.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/insurance?employeeId=${EMP}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("employees can view their own insurance (200)", async () => {
    H.sqlClientQuery.mockReturnValue([insuranceRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/insurance?employeeId=${EMP}`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

// =================== GET /v1/hrms/medical/history ===================
describe("GET /v1/hrms/medical/history — medical history timeline", () => {
  it("returns history timeline (200)", async () => {
    H.sqlClientQuery.mockReturnValue([
      claimRow({ status: "approved", decided_at: "2026-02-01T00:00:00Z" }),
      claimRow({ id: "cccccccc-0002-4000-8000-000000000002", status: "rejected", decided_at: "2026-01-15T00:00:00Z" }),
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/history?employeeId=${EMP}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    await app.close();
  });

  it("returns empty history (200)", async () => {
    H.sqlClientQuery.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/history?employeeId=${EMP}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("supports pagination params (200)", async () => {
    H.sqlClientQuery.mockReturnValue([claimRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/history?employeeId=${EMP}&limit=10&offset=5`, headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 when employeeId is missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/history", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 when employeeId is not a UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/history?employeeId=bad-id", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on limit exceeding max", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/history?employeeId=${EMP}&limit=200`, headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/history?employeeId=${EMP}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/history?employeeId=${EMP}`, headers: auth(USER, ["audit_officer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("employees can view their own history (200)", async () => {
    H.sqlClientQuery.mockReturnValue([claimRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/medical/history?employeeId=${EMP}`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
