/**
 * Seniority + DPC eligibility route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const DEPT_ID = "bbbbbbbb-0001-4000-8000-000000000001";
const DESIG_ID = "cccccccc-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({ selectFrom: vi.fn(), update: vi.fn(), insert: vi.fn(), execute: vi.fn() }));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return { limit: (n: unknown) => H.selectFrom(...args, ...w), orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }), then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject) };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args) }),
    }),
  });
  const mockTx = { select: (...args: unknown[]) => createSelectChain(...args), update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }), insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }), execute: (q: unknown) => H.execute(q) };
  return { db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) }, scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx), sqlClient: { end: async () => {} }, sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) } };
});

vi.mock("../src/shared/infra.js", () => ({ cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() }, queue: { publish: async () => {} } }));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

function makeEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: "eeeeeeee-0001-4000-8000-000000000001",
    tenantId: TENANT,
    employeeNo: "EMP-001",
    fullName: "Alice Senior",
    departmentId: DEPT_ID,
    designationId: DESIG_ID,
    dateOfJoining: "2015-03-01",
    dateOfBirth: "1980-06-15",
    confirmationDate: "2015-09-01",
    status: "confirmed",
    ...overrides,
  };
}

function makeAppraisal(employeeId: string, overallGrade: number) {
  return {
    id: `aaaa${employeeId.slice(4)}`,
    tenantId: TENANT,
    employeeId,
    appraisalPeriod: "2024-25",
    overallGrade: String(overallGrade),
  };
}

// Mock data: multiple employees with different seniority
const EMP1 = makeEmployee({ id: "eeeeeeee-0001-4000-8000-000000000001", employeeNo: "EMP-001", fullName: "Alice Senior", dateOfJoining: "2015-03-01", dateOfBirth: "1980-06-15", confirmationDate: "2015-09-01" });
const EMP2 = makeEmployee({ id: "eeeeeeee-0002-4000-8000-000000000002", employeeNo: "EMP-002", fullName: "Bob Junior", dateOfJoining: "2020-07-01", dateOfBirth: "1990-01-10", confirmationDate: "2021-01-01" });
const EMP3 = makeEmployee({ id: "eeeeeeee-0003-4000-8000-000000000003", employeeNo: "EMP-003", fullName: "Charlie Same", dateOfJoining: "2015-03-01", dateOfBirth: "1982-08-20", confirmationDate: "2015-09-01" });
const EMP_SEPARATED = makeEmployee({ id: "eeeeeeee-0004-4000-8000-000000000004", employeeNo: "EMP-004", fullName: "Dave Gone", status: "separated" });

let callIndex = 0;

beforeEach(() => {
  vi.clearAllMocks();
  callIndex = 0;
  // Default: first call returns employees, second call returns appraisals
  H.selectFrom.mockImplementation((..._args: unknown[]) => {
    callIndex++;
    if (callIndex === 1) return [EMP1, EMP2, EMP3, EMP_SEPARATED];
    if (callIndex === 2) return [makeAppraisal(EMP1.id, 8.5), makeAppraisal(EMP3.id, 7.0)];
    return [];
  });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /v1/hrms/seniority
   ═══════════════════════════════════════════════════════════════════════════ */
describe("GET /v1/hrms/seniority", () => {
  it("200 — returns ranked seniority list", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toBeDefined();
    expect(body.count).toBeGreaterThan(0);
    expect(body.asOf).toBeDefined();
    // EMP1 joined 2015-03-01 with DOB 1980 → rank 1 (older than EMP3 with same join date)
    expect(body.data[0].employeeNo).toBe("EMP-001");
    expect(body.data[0].rank).toBe(1);
    // EMP3 same join date but younger → rank 2
    expect(body.data[1].employeeNo).toBe("EMP-003");
    expect(body.data[1].rank).toBe(2);
    // EMP2 joined later → rank 3
    expect(body.data[2].employeeNo).toBe("EMP-002");
    expect(body.data[2].rank).toBe(3);
    // Separated employees excluded
    expect(body.data.every((d: { employeeNo: string }) => d.employeeNo !== "EMP-004")).toBe(true);
    await app.close();
  });

  it("200 — filters by departmentId", async () => {
    const OTHER_DEPT = "bbbbbbbb-9999-4000-8000-000000000099";
    H.selectFrom.mockImplementation((..._args: unknown[]) => {
      callIndex++;
      if (callIndex === 1) return [EMP1, makeEmployee({ id: "eeeeeeee-0005-4000-8000-000000000005", employeeNo: "EMP-005", fullName: "Eve Other", departmentId: OTHER_DEPT })];
      return [];
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/seniority?departmentId=${DEPT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.every((d: { departmentId: string }) => d.departmentId === DEPT_ID)).toBe(true);
    await app.close();
  });

  it("200 — filters by designationId", async () => {
    const OTHER_DESIG = "cccccccc-9999-4000-8000-000000000099";
    H.selectFrom.mockImplementation((..._args: unknown[]) => {
      callIndex++;
      if (callIndex === 1) return [EMP1, makeEmployee({ id: "eeeeeeee-0006-4000-8000-000000000006", employeeNo: "EMP-006", fullName: "Frank Other", designationId: OTHER_DESIG })];
      return [];
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/seniority?designationId=${DESIG_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.every((d: { designationId: string }) => d.designationId === DESIG_ID)).toBe(true);
    await app.close();
  });

  it("200 — accepts asOf date parameter", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority?asOf=2024-01-01",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().asOf).toBe("2024-01-01");
    await app.close();
  });

  it("200 — empty list when no employees match", async () => {
    H.selectFrom.mockImplementation((..._args: unknown[]) => {
      callIndex++;
      if (callIndex === 1) return [];
      return [];
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().count).toBe(0);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("200 — tie-break by merit grade DESC when DOJ and DOB equal", async () => {
    const EMP_A = makeEmployee({ id: "eeeeeeee-0010-4000-8000-000000000010", employeeNo: "EMP-A", fullName: "Alpha", dateOfJoining: "2018-01-01", dateOfBirth: "1985-05-05" });
    const EMP_B = makeEmployee({ id: "eeeeeeee-0011-4000-8000-000000000011", employeeNo: "EMP-B", fullName: "Beta", dateOfJoining: "2018-01-01", dateOfBirth: "1985-05-05" });
    H.selectFrom.mockImplementation((..._args: unknown[]) => {
      callIndex++;
      if (callIndex === 1) return [EMP_A, EMP_B];
      if (callIndex === 2) return [makeAppraisal(EMP_A.id, 6.0), makeAppraisal(EMP_B.id, 9.0)];
      return [];
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // Higher merit grade → ranked first when DOJ and DOB are tied
    expect(body.data[0].employeeNo).toBe("EMP-B");
    expect(body.data[1].employeeNo).toBe("EMP-A");
    await app.close();
  });

  it("400 — invalid departmentId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority?departmentId=not-a-uuid",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid designationId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority?designationId=xyz",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (employee)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("403 — insufficient role (viewer)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — hr_officer can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(USER, ["hr_officer"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — super_admin can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(USER, ["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — manager can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /v1/hrms/dpc/eligibility
   ═══════════════════════════════════════════════════════════════════════════ */
describe("GET /v1/hrms/dpc/eligibility", () => {
  it("200 — returns eligible and ineligible buckets", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=5",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.eligible).toBeDefined();
    expect(body.ineligible).toBeDefined();
    expect(body.eligibleCount).toBeDefined();
    expect(body.ineligibleCount).toBeDefined();
    expect(body.minQualifyingYears).toBe(5);
    expect(body.asOf).toBeDefined();
    // EMP1 and EMP3 joined 2015 → ~10 years qualifying → eligible
    // EMP2 joined 2020 → ~5 years qualifying → may be eligible or ineligible depending on asOf
    expect(body.eligibleCount + body.ineligibleCount).toBe(body.eligible.length + body.ineligible.length);
    await app.close();
  });

  it("200 — eligible employees get eligibilityRank field", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=3",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    if (body.eligible.length > 0) {
      expect(body.eligible[0].eligibilityRank).toBe(1);
    }
    await app.close();
  });

  it("200 — defaults minQualifyingYears to 5", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().minQualifyingYears).toBe(5);
    await app.close();
  });

  it("200 — filters by departmentId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/dpc/eligibility?departmentId=${DEPT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const allEmployees = [...body.eligible, ...body.ineligible];
    expect(allEmployees.every((d: { departmentId: string }) => d.departmentId === DEPT_ID)).toBe(true);
    await app.close();
  });

  it("200 — filters by designationId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/dpc/eligibility?designationId=${DESIG_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const allEmployees = [...body.eligible, ...body.ineligible];
    expect(allEmployees.every((d: { designationId: string }) => d.designationId === DESIG_ID)).toBe(true);
    await app.close();
  });

  it("200 — accepts custom asOf date", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?asOf=2024-01-01&minQualifyingYears=8",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.asOf).toBe("2024-01-01");
    expect(body.minQualifyingYears).toBe(8);
    await app.close();
  });

  it("200 — high minQualifyingYears puts everyone ineligible", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=40",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.eligibleCount).toBe(0);
    expect(body.ineligibleCount).toBeGreaterThan(0);
    await app.close();
  });

  it("200 — zero minQualifyingYears puts everyone eligible", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.eligibleCount).toBeGreaterThan(0);
    expect(body.ineligibleCount).toBe(0);
    await app.close();
  });

  it("400 — invalid departmentId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?departmentId=bad-id",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid designationId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?designationId=nope",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — minQualifyingYears exceeds max (40)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=41",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — minQualifyingYears negative", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=-1",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (employee)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("403 — insufficient role (viewer)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — hr_officer can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: auth(USER, ["hr_officer"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — super_admin can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: auth(USER, ["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — manager can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
