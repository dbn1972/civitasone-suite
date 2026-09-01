/**
 * Disciplinary module route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all endpoints.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const CASE_ID = "cccccccc-0001-4000-8000-000000000001";
const SUSP_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  // repo mocks
  findCase: vi.fn(),
  listCasesByEmployee: vi.fn(),
  insertCase: vi.fn(),
  updateCase: vi.fn(),
  appendEvent: vi.fn(),
  listEvents: vi.fn(),
  hasActiveSuspension: vi.fn(),
  insertSuspension: vi.fn(),
  findSuspension: vi.fn(),
  listSuspensionsByEmployee: vi.fn(),
  updateSuspension: vi.fn(),
  // commands mock
  submitDisciplinaryForApproval: vi.fn(),
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
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

vi.mock("../src/modules/disciplinary/repo.js", () => ({
  findCase: (...a: unknown[]) => H.findCase(...a),
  listCasesByEmployee: (...a: unknown[]) => H.listCasesByEmployee(...a),
  insertCase: (...a: unknown[]) => H.insertCase(...a),
  updateCase: (...a: unknown[]) => H.updateCase(...a),
  appendEvent: (...a: unknown[]) => H.appendEvent(...a),
  listEvents: (...a: unknown[]) => H.listEvents(...a),
  hasActiveSuspension: (...a: unknown[]) => H.hasActiveSuspension(...a),
  insertSuspension: (...a: unknown[]) => H.insertSuspension(...a),
  findSuspension: (...a: unknown[]) => H.findSuspension(...a),
  listSuspensionsByEmployee: (...a: unknown[]) => H.listSuspensionsByEmployee(...a),
  updateSuspension: (...a: unknown[]) => H.updateSuspension(...a),
}));

vi.mock("../src/modules/disciplinary/commands.js", () => ({
  submitDisciplinaryForApproval: (...a: unknown[]) => H.submitDisciplinaryForApproval(...a),
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const employee = () => ({
  id: EMP, tenantId: TENANT, employeeNo: "E-001", fullName: "Test Emp",
  departmentId: "dddddddd-0001-4000-8000-000000000001", status: "confirmed",
});

const makeCase = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: CASE_ID, tenantId: TENANT, employeeId: EMP,
  caseNo: "DC-2026-001", proceedingType: "major",
  status: "opened", allegation: "Misuse of office",
  chargeMemoRef: null, chargeMemoDate: null,
  inquiryOfficerId: null, inquiryOfficerName: null, inquiryAppointedDate: null,
  finding: null, findingNotes: null, findingDate: null,
  penaltyClass: null, penaltyType: null, penaltyDetail: null, penaltyDate: null,
  appealFiledDate: null, appealAuthority: null,
  appealOutcome: null, appealDecidedDate: null,
  closedAt: null, createdBy: USER, updatedBy: USER, version: 1,
  createdAt: new Date(), updatedAt: new Date(),
  ...over,
});

const makeSuspension = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SUSP_ID, tenantId: TENANT, employeeId: EMP,
  fromDate: "2026-01-01", toDate: null, paySuspended: true,
  subsistencePct: "50.00", status: "active", revokedDate: null,
  remarks: null, caseId: null, orderRef: null,
  createdBy: USER, updatedBy: USER, version: 1,
  createdAt: new Date(), updatedAt: new Date(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([employee()]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue({ rowCount: 1 });
  H.findCase.mockResolvedValue(null);
  H.listCasesByEmployee.mockResolvedValue([]);
  H.insertCase.mockResolvedValue(undefined);
  H.updateCase.mockResolvedValue(undefined);
  H.appendEvent.mockResolvedValue(undefined);
  H.listEvents.mockResolvedValue([]);
  H.hasActiveSuspension.mockResolvedValue(false);
  H.insertSuspension.mockResolvedValue(undefined);
  H.findSuspension.mockResolvedValue(null);
  H.listSuspensionsByEmployee.mockResolvedValue([]);
  H.updateSuspension.mockResolvedValue(undefined);
  H.submitDisciplinaryForApproval.mockResolvedValue({ id: CASE_ID, status: "accepted", correlationId: "cor-1" });
});
afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// =================== Open / List / Read Cases ===================
describe("POST /v1/hrms/employees/:id/disciplinary-cases", () => {
  const payload = { caseNo: "DC-2026-001", proceedingType: "major", allegation: "Misuse of office" };

  it("opens a disciplinary case (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().employeeId).toBe(EMP);
    expect(r.json().status).toBe("opened");
    expect(r.json().caseNo).toBe("DC-2026-001");
    await app.close();
  });

  it("hr_officer can open a case (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, headers: auth(USER, ["hr_officer"]), payload });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("returns 400 on missing allegation", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, headers: auth(), payload: { caseNo: "X" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on invalid UUID param", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/not-uuid/disciplinary-cases`, headers: auth(), payload });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when employee not found", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

describe("GET /v1/hrms/employees/:id/disciplinary-cases", () => {
  it("lists cases for an employee (200)", async () => {
    H.listCasesByEmployee.mockResolvedValue([makeCase()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/disciplinary-cases` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/disciplinary-cases`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/disciplinary-cases/:caseId", () => {
  it("reads a single case (200)", async () => {
    H.findCase.mockResolvedValue(makeCase());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/disciplinary-cases/${CASE_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(CASE_ID);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/disciplinary-cases/${CASE_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/disciplinary-cases/${CASE_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/disciplinary-cases/${CASE_ID}`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/disciplinary-cases/:caseId/events", () => {
  it("lists state-transition events (200)", async () => {
    H.findCase.mockResolvedValue(makeCase());
    H.listEvents.mockResolvedValue([{ id: "e1", action: "open", toStatus: "opened" }]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/events`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/events`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/events` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// =================== Transitions ===================
describe("POST /v1/hrms/disciplinary-cases/:caseId/charge-memo", () => {
  const payload = { chargeMemoRef: "CM/2026/01", chargeMemoDate: "2026-02-01" };

  it("issues a charge memo (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/charge-memo`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(CASE_ID);
    expect(r.json().status).toBe("charge_memo_issued");
    await app.close();
  });

  it("returns 400 on missing chargeMemoRef", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/charge-memo`, headers: auth(), payload: { chargeMemoDate: "2026-02-01" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on invalid date format", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/charge-memo`, headers: auth(), payload: { chargeMemoRef: "X", chargeMemoDate: "01-02-2026" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/charge-memo`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 409 when case is not in opened state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "penalty_imposed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/charge-memo`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/charge-memo`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/charge-memo`, headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary-cases/:caseId/inquiry", () => {
  const payload = { inquiryOfficerName: "Mr. Sharma", inquiryAppointedDate: "2026-03-01" };

  it("appoints an inquiry officer for a major case (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "charge_memo_issued", proceedingType: "major" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/inquiry`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("inquiry_appointed");
    await app.close();
  });

  it("returns 400 on missing inquiryOfficerName", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "charge_memo_issued", proceedingType: "major" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/inquiry`, headers: auth(), payload: { inquiryAppointedDate: "2026-03-01" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 409 when minor case tries to appoint inquiry", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "charge_memo_issued", proceedingType: "minor" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/inquiry`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 409 from wrong state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened", proceedingType: "major" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/inquiry`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/inquiry`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/inquiry`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary-cases/:caseId/finding", () => {
  const payload = { finding: "guilty", findingDate: "2026-04-01" };

  it("records a finding (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "inquiry_appointed", proceedingType: "major" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/finding`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("finding_recorded");
    expect(r.json().finding).toBe("guilty");
    await app.close();
  });

  it("returns 400 on invalid finding value", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "inquiry_appointed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/finding`, headers: auth(), payload: { finding: "unknown", findingDate: "2026-04-01" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 409 from wrong state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/finding`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/finding`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/finding`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary-cases/:caseId/penalty", () => {
  const payload = { penaltyType: "dismissal", penaltyDate: "2026-05-01" };

  it("imposes a major penalty on a finding_recorded major case (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "finding_recorded", proceedingType: "major" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("penalty_imposed");
    expect(r.json().penaltyClass).toBe("major");
    expect(r.json().penaltyType).toBe("dismissal");
    await app.close();
  });

  it("imposes a minor penalty on a charge_memo_issued minor case (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "charge_memo_issued", proceedingType: "minor" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, headers: auth(), payload: { penaltyType: "censure", penaltyDate: "2026-05-01" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().penaltyClass).toBe("minor");
    await app.close();
  });

  it("returns 400 for unknown penalty type", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "finding_recorded" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, headers: auth(), payload: { penaltyType: "unknown_penalty", penaltyDate: "2026-05-01" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("UNKNOWN_PENALTY");
    await app.close();
  });

  it("returns 409 when major penalty on minor proceeding", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "charge_memo_issued", proceedingType: "minor" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, headers: auth(), payload: { penaltyType: "dismissal", penaltyDate: "2026-05-01" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("PENALTY_MISMATCH");
    await app.close();
  });

  it("returns 409 from wrong state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 403 for hr_officer (needs hr_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, headers: auth(USER, ["hr_officer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/penalty`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary/:id/submit-approval", () => {
  const payload = { penaltyType: "dismissal", penaltyDate: "2026-05-01" };

  it("submits proposed penalty for eOffice approval (202)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "finding_recorded", proceedingType: "major" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary/${CASE_ID}/submit-approval`, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("returns 400 for unknown penalty type", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "finding_recorded" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary/${CASE_ID}/submit-approval`, headers: auth(), payload: { penaltyType: "bogus", penaltyDate: "2026-05-01" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("UNKNOWN_PENALTY");
    await app.close();
  });

  it("returns 409 when major penalty on minor proceeding", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "charge_memo_issued", proceedingType: "minor" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary/${CASE_ID}/submit-approval`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("PENALTY_MISMATCH");
    await app.close();
  });

  it("returns 409 from wrong state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened", proceedingType: "major" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary/${CASE_ID}/submit-approval`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary/${CASE_ID}/submit-approval`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 403 for hr_officer (needs hr_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary/${CASE_ID}/submit-approval`, headers: auth(USER, ["hr_officer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary/${CASE_ID}/submit-approval`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary-cases/:caseId/appeal", () => {
  const payload = { appealFiledDate: "2026-06-01", appealAuthority: "Appellate Tribunal" };

  it("files an appeal after penalty imposed (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "penalty_imposed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("appeal_filed");
    await app.close();
  });

  it("returns 400 on missing appealAuthority", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "penalty_imposed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal`, headers: auth(), payload: { appealFiledDate: "2026-06-01" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 409 from wrong state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary-cases/:caseId/appeal-decision", () => {
  const payload = { appealOutcome: "upheld", appealDecidedDate: "2026-07-01" };

  it("decides an appeal (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "appeal_filed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal-decision`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("appeal_decided");
    expect(r.json().appealOutcome).toBe("upheld");
    await app.close();
  });

  it("returns 400 on invalid appealOutcome", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "appeal_filed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal-decision`, headers: auth(), payload: { appealOutcome: "invalid", appealDecidedDate: "2026-07-01" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 409 from wrong state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal-decision`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal-decision`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 403 for hr_officer (needs hr_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal-decision`, headers: auth(USER, ["hr_officer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/appeal-decision`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary-cases/:caseId/close", () => {
  it("closes a case after penalty imposed (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "penalty_imposed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/close`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("closed");
    await app.close();
  });

  it("closes a case after appeal decided (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "appeal_decided" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/close`, headers: auth(), payload: { notes: "concluded" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("closed");
    await app.close();
  });

  it("returns 409 from wrong state", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/close`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/close`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 403 for hr_officer (needs hr_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/close`, headers: auth(USER, ["hr_officer"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/close`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/disciplinary-cases/:caseId/drop", () => {
  it("drops an opened case (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "opened" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/drop`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("dropped");
    await app.close();
  });

  it("drops a charge_memo_issued case (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "charge_memo_issued" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/drop`, headers: auth(), payload: { notes: "exonerated" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("dropped");
    await app.close();
  });

  it("drops a finding_recorded case (200)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "finding_recorded" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/drop`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("dropped");
    await app.close();
  });

  it("returns 409 from wrong state (penalty_imposed cannot drop)", async () => {
    H.findCase.mockResolvedValue(makeCase({ status: "penalty_imposed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/drop`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("returns 404 when case not found", async () => {
    H.findCase.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/drop`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 403 for hr_officer (needs hr_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/drop`, headers: auth(USER, ["hr_officer"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/disciplinary-cases/${CASE_ID}/drop`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// =================== Suspensions ===================
describe("POST /v1/hrms/employees/:id/suspensions", () => {
  const payload = { fromDate: "2026-01-15", paySuspended: true, subsistencePct: 50 };

  it("accepts a suspension for async write (202)", async () => {
    // This write is now asynchronous: the route publishes the F3 command
    // `disciplinary_routes__3` and answers 202 Accepted; the row itself is
    // written by the module's F3 consumer (covered by
    // src/modules/disciplinary/f3-consumer.test.ts). It used to answer 201
    // with status "active" when the insert happened inline.
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().employeeId).toBe(EMP);
    expect(r.json().status).toBe("accepted");
    expect(r.json().paySuspended).toBe(true);
    await app.close();
  });

  it("returns 400 on missing fromDate", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth(), payload: { paySuspended: true } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 on invalid UUID param", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/not-uuid/suspensions`, headers: auth(), payload });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/suspensions`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for hr_officer (needs hr_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth(USER, ["hr_officer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when employee not found", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 409 when employee already has active suspension", async () => {
    H.hasActiveSuspension.mockResolvedValue(true);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ACTIVE_SUSPENSION_EXISTS");
    await app.close();
  });
});

describe("GET /v1/hrms/employees/:id/suspensions", () => {
  it("lists suspensions for an employee (200)", async () => {
    H.listSuspensionsByEmployee.mockResolvedValue([makeSuspension()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("hr_officer can list suspensions (200)", async () => {
    H.listSuspensionsByEmployee.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth(USER, ["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/suspensions` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/suspensions`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/suspensions/:suspId/revoke", () => {
  const payload = { revokedDate: "2026-03-01" };

  it("revokes an active suspension (200)", async () => {
    H.findSuspension.mockResolvedValue(makeSuspension({ status: "active" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/suspensions/${SUSP_ID}/revoke`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(SUSP_ID);
    expect(r.json().status).toBe("revoked");
    await app.close();
  });

  it("returns 400 on missing revokedDate", async () => {
    H.findSuspension.mockResolvedValue(makeSuspension());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/suspensions/${SUSP_ID}/revoke`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 on invalid UUID param", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/suspensions/not-a-uuid/revoke`, headers: auth(), payload });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when suspension not found", async () => {
    H.findSuspension.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/suspensions/${SUSP_ID}/revoke`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 409 when suspension already revoked", async () => {
    H.findSuspension.mockResolvedValue(makeSuspension({ status: "revoked" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/suspensions/${SUSP_ID}/revoke`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 403 for hr_officer (needs hr_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/suspensions/${SUSP_ID}/revoke`, headers: auth(USER, ["hr_officer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/suspensions/${SUSP_ID}/revoke`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
