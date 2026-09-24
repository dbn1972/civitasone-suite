/**
 * Route-level tests for APAR / SPARROW multi-authority workflow.
 * Covers: happy path, 400, 401, 403, 404, 409
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createMockSqlClient } from "./fixtures/mock-sql-client.js";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "aaaaaaaa-2222-4000-8000-000000000001";
const RO = "aaaaaaaa-3333-4000-8000-000000000001";
const RVO = "aaaaaaaa-4444-4000-8000-000000000001";
const AA = "aaaaaaaa-5555-4000-8000-000000000001";
const APAR_ID = "cccccccc-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  findAppraisal: vi.fn(),
  updateAppraisal: vi.fn(),
  appendHistory: vi.fn(),
  upsertScore: vi.fn(),
  listScores: vi.fn(),
  listHistory: vi.fn(),
  listAppraisals: vi.fn(),
  listDirectReportActorIds: vi.fn(),
  resolveEmployeeForActor: vi.fn(),
}));

vi.mock("../src/modules/apar/repo.js", () => ({
  listAppraisals: (...a: unknown[]) => H.listAppraisals(...a),
  findAppraisal: (...a: unknown[]) => H.findAppraisal(...a),
  updateAppraisal: (...a: unknown[]) => H.updateAppraisal(...a),
  appendHistory: (...a: unknown[]) => H.appendHistory(...a),
  upsertScore: (...a: unknown[]) => H.upsertScore(...a),
  listScores: (...a: unknown[]) => H.listScores(...a),
  listHistory: (...a: unknown[]) => H.listHistory(...a),
  listDirectReportActorIds: (...a: unknown[]) => H.listDirectReportActorIds(...a),
}));

// apar/routes.ts's resolveAparReadScope resolves "manager" callers through
// this module (same actor<->employee identity link employee/routes.ts's
// resolveManagerScope uses). Mocked wholesale like repo.js above so tests
// control the link deterministically instead of needing a real DB row.
vi.mock("../src/modules/employee/actor-link.js", () => ({
  resolveEmployeeForActor: (...a: unknown[]) => H.resolveEmployeeForActor(...a),
  extractActorEmail: () => undefined,
}));

vi.mock("../src/shared/db.js", () => {
  const mockTx = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: () => ({ rowCount: 1 }) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => ({ onConflictDoNothing: () => ({ returning: () => [] }), onConflictDoUpdate: () => ({}) }) }),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: createMockSqlClient(),
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const baseAppraisal = (overrides = {}) => ({
  id: APAR_ID, tenantId: TENANT, employeeId: EMP,
  reportingOfficerId: RO, reviewingOfficerId: RVO, acceptingAuthorityId: AA,
  appraisalPeriod: "2024-25", status: "self_pending",
  selfAppraisal: null, reportingPenPicture: null, reviewingRemarks: null,
  acceptingRemarks: null, overallGrade: null, overallBand: null,
  representation: null, disclosedAt: null,
  version: 1, createdAt: new Date(), updatedAt: new Date(),
  createdBy: USER, updatedBy: USER,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.updateAppraisal.mockResolvedValue(undefined);
  H.appendHistory.mockResolvedValue(undefined);
  H.upsertScore.mockResolvedValue(undefined);
  H.listAppraisals.mockResolvedValue([]);
  H.listDirectReportActorIds.mockResolvedValue([]);
  H.resolveEmployeeForActor.mockResolvedValue(undefined);
});
afterAll(async () => { await sqlClient.end(); });

describe("APAR — POST /v1/hrms/apar (create)", () => {
  it("201 — creates an APAR (happy path)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apar", headers: auth(), payload: {
      employeeId: EMP, appraisalPeriod: "2024-25",
      reportingOfficerId: RO, reviewingOfficerId: RVO, acceptingAuthorityId: AA,
    }});
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("self_pending");
    expect(r.json().id).toBeDefined();
    await app.close();
  });

  it("400 — missing required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apar", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — employee is own officer (self-officer)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apar", headers: auth(), payload: {
      employeeId: EMP, appraisalPeriod: "2024-25",
      reportingOfficerId: EMP, reviewingOfficerId: RVO, acceptingAuthorityId: AA,
    }});
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("SELF_OFFICER_FORBIDDEN");
    await app.close();
  });

  it("400 — officers not distinct (duplicate)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apar", headers: auth(), payload: {
      employeeId: EMP, appraisalPeriod: "2024-25",
      reportingOfficerId: RO, reviewingOfficerId: RO, acceptingAuthorityId: AA,
    }});
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("OFFICERS_NOT_DISTINCT");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apar", payload: {
      employeeId: EMP, appraisalPeriod: "2024-25",
      reportingOfficerId: RO, reviewingOfficerId: RVO, acceptingAuthorityId: AA,
    }});
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role cannot create APAR", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apar", headers: auth(USER, ["employee"]), payload: {
      employeeId: EMP, appraisalPeriod: "2024-25",
      reportingOfficerId: RO, reviewingOfficerId: RVO, acceptingAuthorityId: AA,
    }});
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("APAR — POST /v1/hrms/apar/:id/self-appraisal", () => {
  it("200 — employee submits self-appraisal (happy path)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "self_pending" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/self-appraisal`,
      headers: auth(EMP, ["employee"]), payload: { selfAppraisal: "I did good work" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("reporting_officer");
    await app.close();
  });

  it("400 — missing selfAppraisal field", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "self_pending" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/self-appraisal`,
      headers: auth(EMP, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/self-appraisal`, payload: { selfAppraisal: "x" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong actor (not the employee)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "self_pending" }));
    const OUTSIDER = "aaaaaaaa-9999-4000-8000-000000000001";
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/self-appraisal`,
      headers: auth(OUTSIDER, ["manager"]), payload: { selfAppraisal: "x" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_STAGE_OWNER");
    await app.close();
  });

  it("404 — appraisal not found", async () => {
    H.findAppraisal.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/self-appraisal`,
      headers: auth(EMP, ["employee"]), payload: { selfAppraisal: "x" } });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("409 — wrong stage (already at reporting_officer)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reporting_officer" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/self-appraisal`,
      headers: auth(EMP, ["employee"]), payload: { selfAppraisal: "x" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STAGE");
    await app.close();
  });
});

describe("APAR — POST /v1/hrms/apar/:id/reporting", () => {
  it("200 — reporting officer submits scores (happy path)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reporting_officer" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reporting`,
      headers: auth(RO, ["manager"]), payload: {
        penPicture: "Good officer",
        // KRA weights must sum to 100 (route schema refine); `weight` is not
        // optional in practice despite its Zod default.
        scores: [{ attribute: "integrity", weight: 60, score: 8 }, { attribute: "leadership", weight: 40, score: 7 }],
      }});
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("reviewing_officer");
    await app.close();
  });

  it("400 — empty scores array", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reporting_officer" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reporting`,
      headers: auth(RO, ["manager"]), payload: { penPicture: "x", scores: [] }});
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("403 — employee cannot act as reporting officer", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reporting_officer" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reporting`,
      headers: auth(EMP, ["employee"]), payload: { penPicture: "x", scores: [{ attribute: "a", weight: 100, score: 5 }] }});
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SELF_REVIEW_FORBIDDEN");
    await app.close();
  });

  it("409 — wrong stage", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "self_pending" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reporting`,
      headers: auth(RO, ["manager"]), payload: { penPicture: "x", scores: [{ attribute: "a", weight: 100, score: 5 }] }});
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("404 — not found", async () => {
    H.findAppraisal.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reporting`,
      headers: auth(RO, ["manager"]), payload: { penPicture: "x", scores: [{ attribute: "a", weight: 100, score: 5 }] }});
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("APAR — POST /v1/hrms/apar/:id/reviewing", () => {
  it("200 — reviewing officer concurs (happy path)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reviewing_officer" }));
    H.listScores.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reviewing`,
      headers: auth(RVO, ["manager"]), payload: { decision: "concur", remarks: "I agree" }});
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("accepting_authority");
    expect(r.json().decision).toBe("concur");
    await app.close();
  });

  it("200 — reviewing officer varies scores", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reviewing_officer" }));
    H.listScores.mockResolvedValue([{ attribute: "integrity", weight: "1", score: 8 }]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reviewing`,
      headers: auth(RVO, ["manager"]), payload: {
        decision: "vary", remarks: "adjusted",
        variations: [{ attribute: "integrity", score: 6 }],
      }});
    expect(r.statusCode).toBe(200);
    expect(r.json().decision).toBe("vary");
    await app.close();
  });

  it("400 — invalid decision value", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reviewing`,
      headers: auth(RVO, ["manager"]), payload: { decision: "maybe", remarks: "hmm" }});
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("403 — employee cannot review themselves", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reviewing_officer" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reviewing`,
      headers: auth(EMP, ["employee"]), payload: { decision: "concur", remarks: "x" }});
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("409 — wrong stage", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "accepting_authority" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/reviewing`,
      headers: auth(RVO, ["manager"]), payload: { decision: "concur", remarks: "x" }});
    expect(r.statusCode).toBe(409);
    await app.close();
  });
});

describe("APAR — POST /v1/hrms/apar/:id/accept (accepting authority)", () => {
  it("200 — accepting authority finalises grade (happy path)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "accepting_authority" }));
    H.listScores.mockResolvedValue([
      { attribute: "integrity", weight: "1", score: 9 },
      { attribute: "leadership", weight: "1", score: 8 },
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/accept`,
      headers: auth(AA, ["manager"]), payload: { remarks: "Finalised" }});
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("disclosed");
    expect(r.json().overallGrade).toBeCloseTo(8.5);
    expect(r.json().band).toBe("Very Good");
    await app.close();
  });

  it("400 — missing remarks", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "accepting_authority" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/accept`,
      headers: auth(AA, ["manager"]), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("409 — no scores recorded", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "accepting_authority" }));
    H.listScores.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/accept`,
      headers: auth(AA, ["manager"]), payload: { remarks: "ok" }});
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_SCORES");
    await app.close();
  });

  it("403 — employee cannot act as accepting authority", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "accepting_authority" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/accept`,
      headers: auth(EMP, ["employee"]), payload: { remarks: "x" }});
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("409 — wrong stage", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "reviewing_officer" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/accept`,
      headers: auth(AA, ["manager"]), payload: { remarks: "x" }});
    expect(r.statusCode).toBe(409);
    await app.close();
  });
});

describe("APAR — POST /v1/hrms/apar/:id/representation", () => {
  it("200 — employee files representation (happy path)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "disclosed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/representation`,
      headers: auth(EMP, ["employee"]), payload: { representation: "I disagree with the score" }});
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("representation");
    await app.close();
  });

  it("400 — missing representation text", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "disclosed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/representation`,
      headers: auth(EMP, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("409 — wrong stage (not disclosed)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "finalised" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/representation`,
      headers: auth(EMP, ["employee"]), payload: { representation: "x" }});
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("404 — not found", async () => {
    H.findAppraisal.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/representation`,
      headers: auth(EMP, ["employee"]), payload: { representation: "x" }});
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("APAR — POST /v1/hrms/apar/:id/finalise", () => {
  it("200 — HR finalises from disclosed (happy path)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "disclosed", overallGrade: "8.5", overallBand: "Very Good" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/finalise`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("finalised");
    await app.close();
  });

  it("200 — HR finalises from representation", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "representation", overallGrade: "7", overallBand: "Very Good" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/finalise`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("finalised");
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/finalise` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot finalise", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/finalise`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — not found", async () => {
    H.findAppraisal.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/finalise`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — cannot finalise from self_pending", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ status: "self_pending" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apar/${APAR_ID}/finalise`, headers: auth() });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STAGE");
    await app.close();
  });
});

describe("APAR — GET /v1/hrms/apar/:id", () => {
  it("200 — returns appraisal with scores and history (happy path)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal());
    H.listScores.mockResolvedValue([{ attribute: "integrity", weight: "1", score: 8 }]);
    H.listHistory.mockResolvedValue([{ fromStage: null, toStage: "self_pending" }]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.appraisal.id).toBe(APAR_ID);
    expect(body.scores).toHaveLength(1);
    expect(body.history).toHaveLength(1);
    await app.close();
  });

  it("400 — invalid uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar/not-a-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("404 — not found", async () => {
    H.findAppraisal.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ── Regression: Bug 1 / Bug 2 — read-side IDOR (list + detail) ─────────────
// GET /v1/hrms/apar was documented "HR sees all; employee sees own" but
// repo.listAppraisals took no actor/employee filter at all; GET /:id had no
// ownership check beyond tenant. Both allowed any employee/manager-role
// caller to read any other employee's appraisal by enumerating ids or via
// the unfiltered list. These tests prove that leak is closed while HR,
// self, and manager-of-report access keep working.
const OTHER_EMP = "aaaaaaaa-2222-4000-8000-000000000002";
const MANAGER = "aaaaaaaa-6666-4000-8000-000000000001";
const MANAGER_EMP_ROW_ID = "dddddddd-0001-4000-8000-000000000001";

describe("APAR — GET /v1/hrms/apar (list) — read-scope regression", () => {
  it("200 — employee role: only the caller's own appraisal(s) come back, repo scoped to [EMP]", async () => {
    H.listAppraisals.mockResolvedValue([baseAppraisal({ employeeId: EMP })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: auth(EMP, ["employee"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].employeeId).toBe(EMP);
    expect(H.listAppraisals).toHaveBeenCalledWith(TENANT, [EMP]);
    // never falls back to unrestricted access for a bare employee caller
    expect(H.listAppraisals).not.toHaveBeenCalledWith(TENANT, null);
    await app.close();
  });

  it("200 — manager role with no resolvable employee link sees nothing (fail closed)", async () => {
    H.resolveEmployeeForActor.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: auth(MANAGER, ["manager"]) });
    expect(r.statusCode).toBe(200);
    expect(H.listAppraisals).toHaveBeenCalledWith(TENANT, []);
    await app.close();
  });

  it("200 — manager role: repo scoped to direct reports' employeeIds only", async () => {
    H.resolveEmployeeForActor.mockResolvedValue({ id: MANAGER_EMP_ROW_ID });
    H.listDirectReportActorIds.mockResolvedValue([EMP]);
    H.listAppraisals.mockResolvedValue([baseAppraisal({ employeeId: EMP })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: auth(MANAGER, ["manager"]) });
    expect(r.statusCode).toBe(200);
    expect(H.listDirectReportActorIds).toHaveBeenCalledWith(TENANT, MANAGER_EMP_ROW_ID);
    expect(H.listAppraisals).toHaveBeenCalledWith(TENANT, [EMP]);
    await app.close();
  });

  it("200 — hr_admin: unrestricted tenant-wide access (scope null)", async () => {
    H.listAppraisals.mockResolvedValue([
      baseAppraisal({ employeeId: EMP }),
      baseAppraisal({ id: "cccccccc-0002-4000-8000-000000000001", employeeId: OTHER_EMP }),
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: auth() }); // default hr_admin
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    expect(H.listAppraisals).toHaveBeenCalledWith(TENANT, null);
    await app.close();
  });
});

describe("APAR — GET /v1/hrms/apar/:id — ownership regression (IDOR)", () => {
  it("200 — employee fetching their own appraisal succeeds", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ employeeId: EMP }));
    H.listScores.mockResolvedValue([]);
    H.listHistory.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth(EMP, ["employee"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().appraisal.employeeId).toBe(EMP);
    await app.close();
  });

  it("404 — employee CANNOT fetch another employee's appraisal by id (IDOR closed)", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ employeeId: OTHER_EMP }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth(EMP, ["employee"]) });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("404 — manager with no resolvable employee link cannot fetch a report's appraisal", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ employeeId: EMP }));
    H.resolveEmployeeForActor.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth(MANAGER, ["manager"]) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("200 — manager fetching a direct report's appraisal succeeds", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ employeeId: EMP }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: MANAGER_EMP_ROW_ID });
    H.listDirectReportActorIds.mockResolvedValue([EMP]);
    H.listScores.mockResolvedValue([]);
    H.listHistory.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth(MANAGER, ["manager"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("404 — manager fetching a NON-report's appraisal is rejected", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ employeeId: OTHER_EMP }));
    H.resolveEmployeeForActor.mockResolvedValue({ id: MANAGER_EMP_ROW_ID });
    H.listDirectReportActorIds.mockResolvedValue([EMP]); // OTHER_EMP is not a report
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth(MANAGER, ["manager"]) });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("200 — hr_admin can fetch any tenant appraisal regardless of employeeId", async () => {
    H.findAppraisal.mockResolvedValue(baseAppraisal({ employeeId: OTHER_EMP }));
    H.listScores.mockResolvedValue([]);
    H.listHistory.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${APAR_ID}`, headers: auth() }); // hr_admin
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
