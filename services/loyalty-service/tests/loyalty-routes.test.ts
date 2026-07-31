/**
 * Route-level coverage tests for loyalty-service.
 * Mock-based approach — no real database connection needed.
 * Covers programs (CRUD + lifecycle), enrolments, accruals, redemptions, tiers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-1111-4000-8000-000000000001";
const PROGRAM_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const ENROLMENT_ID = "cccccccc-1111-4000-8000-000000000001";
const REDEMPTION_ID = "dddddddd-1111-4000-8000-000000000001";
const PROFILE_ID = "eeeeeeee-1111-4000-8000-000000000001";
const TIER_DEF_ID = "ffffffff-1111-4000-8000-000000000001";
const NON_EXISTENT = "00000000-0000-4000-8000-000000000099";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  // Programs repo
  programFindByIdMock: vi.fn(),
  programListMock: vi.fn(),
  programInsertMock: vi.fn(),
  programUpdateMock: vi.fn(),
  // Enrolments repo
  enrolmentFindByIdMock: vi.fn(),
  enrolmentFindByProgramAndProfileMock: vi.fn(),
  enrolmentListByProgramMock: vi.fn(),
  enrolmentListByProfileMock: vi.fn(),
  enrolmentInsertMock: vi.fn(),
  enrolmentUpdateMock: vi.fn(),
  enrolmentAdjustBalanceMock: vi.fn(),
  // Accruals repo
  accrualListByEnrolmentMock: vi.fn(),
  accrualGetBalanceSummaryMock: vi.fn(),
  accrualInsertMock: vi.fn(),
  // Redemptions repo
  redemptionFindByIdMock: vi.fn(),
  redemptionListByEnrolmentMock: vi.fn(),
  redemptionListByTenantMock: vi.fn(),
  redemptionInsertMock: vi.fn(),
  redemptionVoidMock: vi.fn(),
  // Tiers repo
  tierListDefinitionsMock: vi.fn(),
  tierFindCurrentAssignmentMock: vi.fn(),
  tierListAssignmentHistoryMock: vi.fn(),
  tierInsertAssignmentMock: vi.fn(),
  // Shared
  enqueueMock: vi.fn(),
  dbTransactionMock: vi.fn(),
}));

// ─── vi.mock declarations ─────────────────────────────────────────────────────
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn().mockReturnValue("k") },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/programs/repo.js", () => ({
  findById: (...a: unknown[]) => H.programFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.programListMock(...a),
  insert: (...a: unknown[]) => H.programInsertMock(...a),
  update: (...a: unknown[]) => H.programUpdateMock(...a),
  toView: (r: Record<string, unknown>) => ({ ...r, earnRatio: String(r.earnRatio ?? "100"), createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }),
}));

vi.mock("../src/modules/enrolments/repo.js", () => ({
  findById: (...a: unknown[]) => H.enrolmentFindByIdMock(...a),
  findByProgramAndProfile: (...a: unknown[]) => H.enrolmentFindByProgramAndProfileMock(...a),
  listByProgram: (...a: unknown[]) => H.enrolmentListByProgramMock(...a),
  listByProfile: (...a: unknown[]) => H.enrolmentListByProfileMock(...a),
  insert: (...a: unknown[]) => H.enrolmentInsertMock(...a),
  update: (...a: unknown[]) => H.enrolmentUpdateMock(...a),
  adjustBalance: (...a: unknown[]) => H.enrolmentAdjustBalanceMock(...a),
  toView: (r: Record<string, unknown>) => ({ ...r, pointsBalance: String(r.pointsBalance ?? "0"), lifetimePoints: String(r.lifetimePoints ?? "0"), createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", enrolledAt: "2025-01-01T00:00:00.000Z" }),
}));

vi.mock("../src/modules/accruals/repo.js", () => ({
  listByEnrolment: (...a: unknown[]) => H.accrualListByEnrolmentMock(...a),
  getBalanceSummary: (...a: unknown[]) => H.accrualGetBalanceSummaryMock(...a),
  insert: (...a: unknown[]) => H.accrualInsertMock(...a),
  toView: (r: Record<string, unknown>) => ({ ...r, points: String(r.points ?? "0"), accrualDate: "2025-01-01T00:00:00.000Z", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: null }),
}));

vi.mock("../src/modules/redemptions/repo.js", () => ({
  findById: (...a: unknown[]) => H.redemptionFindByIdMock(...a),
  listByEnrolment: (...a: unknown[]) => H.redemptionListByEnrolmentMock(...a),
  listByTenant: (...a: unknown[]) => H.redemptionListByTenantMock(...a),
  insert: (...a: unknown[]) => H.redemptionInsertMock(...a),
  voidRedemption: (...a: unknown[]) => H.redemptionVoidMock(...a),
  toView: (r: Record<string, unknown>) => ({ ...r, points: String(r.points ?? "0"), redeemedAt: "2025-01-01T00:00:00.000Z", createdAt: "2025-01-01T00:00:00.000Z", voidedAt: null, voidReason: null }),
}));

vi.mock("../src/modules/tiers/repo.js", () => ({
  listDefinitions: (...a: unknown[]) => H.tierListDefinitionsMock(...a),
  findCurrentAssignment: (...a: unknown[]) => H.tierFindCurrentAssignmentMock(...a),
  listAssignmentHistory: (...a: unknown[]) => H.tierListAssignmentHistoryMock(...a),
  insertAssignment: (...a: unknown[]) => H.tierInsertAssignmentMock(...a),
  toDefView: (r: Record<string, unknown>) => r,
  toAssignmentView: (r: Record<string, unknown>) => ({ ...r, assignedAt: "2025-01-01T00:00:00.000Z", expiresAt: null, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }),
}));

import { buildApp } from "../src/app.js";

// ─── Token helpers ────────────────────────────────────────────────────────────
function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["loyalty_admin", "super_admin"], sid: "s1" }, SECRET);
}
function userToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["loyalty_user"], sid: "s2" }, SECRET);
}
function noRoleToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["employee"], sid: "s3" }, SECRET);
}

// ─── Factory helpers ──────────────────────────────────────────────────────────
function makeProgram(overrides: Record<string, unknown> = {}) {
  return {
    id: PROGRAM_ID,
    tenantId: TENANT,
    name: "Rewards Plus",
    status: "active",
    earnRatio: BigInt(100),
    expiryDays: null,
    tierConfig: {},
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    ...overrides,
  };
}

function makeEnrolment(overrides: Record<string, unknown> = {}) {
  return {
    id: ENROLMENT_ID,
    tenantId: TENANT,
    programId: PROGRAM_ID,
    profileId: PROFILE_ID,
    status: "active",
    tier: "base",
    pointsBalance: BigInt(500),
    lifetimePoints: BigInt(1000),
    enrolledAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function makeRedemption(overrides: Record<string, unknown> = {}) {
  return {
    id: REDEMPTION_ID,
    tenantId: TENANT,
    enrolmentId: ENROLMENT_ID,
    points: BigInt(100),
    rewardType: "voucher",
    status: "fulfilled",
    redeemedAt: new Date(),
    voidedAt: null,
    voidReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

// ─── Reset ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  H.programInsertMock.mockResolvedValue(undefined);
  H.programUpdateMock.mockResolvedValue(true);
  H.enrolmentInsertMock.mockResolvedValue(undefined);
  H.enrolmentUpdateMock.mockResolvedValue(true);
  H.enrolmentAdjustBalanceMock.mockResolvedValue(true);
  H.accrualInsertMock.mockResolvedValue(undefined);
  H.redemptionInsertMock.mockResolvedValue(undefined);
  H.redemptionVoidMock.mockResolvedValue(true);
  H.tierInsertAssignmentMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
});


// ═══════════════════════════════════════════════════════════════════════════════
// PROGRAMS
// ═══════════════════════════════════════════════════════════════════════════════
describe("Programs CRUD + lifecycle", () => {
  it("POST /v1/loyalty/programs — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/loyalty/programs", payload: { name: "Test" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/loyalty/programs — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/programs",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { name: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/loyalty/programs — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/programs",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/loyalty/programs — 201 creates program", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/programs",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Rewards Plus", earnRatio: 100 },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe("Rewards Plus");
    expect(res.json().data.status).toBe("draft");
    expect(H.programInsertMock).toHaveBeenCalledOnce();
  });

  it("GET /v1/loyalty/programs — 200 lists programs", async () => {
    H.programListMock.mockResolvedValue({ rows: [makeProgram()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/loyalty/programs",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().meta.total).toBe(1);
  });

  it("GET /v1/loyalty/programs — 403 for no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/loyalty/programs",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/loyalty/programs/:id — 200 returns program", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/programs/${PROGRAM_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(PROGRAM_ID);
  });

  it("GET /v1/loyalty/programs/:id — 404 for non-existent", async () => {
    H.programFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/programs/${NON_EXISTENT}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/loyalty/programs/:id — 200 updates program", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "draft" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/loyalty/programs/${PROGRAM_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated Name", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated).toBe(true);
  });

  it("PATCH /v1/loyalty/programs/:id — 422 when not editable", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "archived" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/loyalty/programs/${PROGRAM_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("PATCH /v1/loyalty/programs/:id — 404 for non-existent", async () => {
    H.programFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/loyalty/programs/${NON_EXISTENT}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "X", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/loyalty/programs/:id — 409 on version conflict", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "draft" }));
    H.programUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/loyalty/programs/${PROGRAM_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "X", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });

  it("POST /v1/loyalty/programs/:id/activate — 200 activates draft program", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "draft" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/loyalty/programs/${PROGRAM_ID}/activate`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "active", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("active");
  });

  it("POST /v1/loyalty/programs/:id/activate — 422 invalid transition", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "archived" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/loyalty/programs/${PROGRAM_ID}/activate`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "active", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("DELETE /v1/loyalty/programs/:id — 200 archives program", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "active" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/loyalty/programs/${PROGRAM_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("archived");
  });

  it("DELETE /v1/loyalty/programs/:id — 404 for non-existent", async () => {
    H.programFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/loyalty/programs/${NON_EXISTENT}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/loyalty/programs/:id — 422 for already archived", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "archived" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/loyalty/programs/${PROGRAM_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// ENROLMENTS
// ═══════════════════════════════════════════════════════════════════════════════
describe("Enrolments", () => {
  it("POST /v1/loyalty/enrol — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/loyalty/enrol", payload: { programId: PROGRAM_ID, profileId: PROFILE_ID } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/loyalty/enrol — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/enrol",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { programId: PROGRAM_ID, profileId: PROFILE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/loyalty/enrol — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/enrol",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/loyalty/enrol — 201 enrols member", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "active" }));
    H.enrolmentFindByProgramAndProfileMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/enrol",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { programId: PROGRAM_ID, profileId: PROFILE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("active");
    expect(H.enrolmentInsertMock).toHaveBeenCalledOnce();
  });

  it("POST /v1/loyalty/enrol — 404 when program not found", async () => {
    H.programFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/enrol",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { programId: NON_EXISTENT, profileId: PROFILE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/loyalty/enrol — 422 when program not active", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "draft" }));
    H.enrolmentFindByProgramAndProfileMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/enrol",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { programId: PROGRAM_ID, profileId: PROFILE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("POST /v1/loyalty/enrol — 422 when duplicate enrolment", async () => {
    H.programFindByIdMock.mockResolvedValue(makeProgram({ status: "active" }));
    H.enrolmentFindByProgramAndProfileMock.mockResolvedValue(makeEnrolment());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/enrol",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { programId: PROGRAM_ID, profileId: PROFILE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("GET /v1/loyalty/enrolments — 200 lists by program", async () => {
    H.enrolmentListByProgramMock.mockResolvedValue({ rows: [makeEnrolment()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/enrolments?programId=${PROGRAM_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/loyalty/members/:profileId — 200 lists enrolments", async () => {
    H.enrolmentListByProfileMock.mockResolvedValue({ rows: [makeEnrolment()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/members/${PROFILE_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/loyalty/enrolments/:id — 200 returns enrolment", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/enrolments/${ENROLMENT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(ENROLMENT_ID);
  });

  it("GET /v1/loyalty/enrolments/:id — 404 for non-existent", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/enrolments/${NON_EXISTENT}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/loyalty/enrolments/:id/status — 200 suspends", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ status: "active" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/loyalty/enrolments/${ENROLMENT_ID}/status`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "suspended", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("suspended");
  });

  it("PATCH /v1/loyalty/enrolments/:id/status — 422 invalid transition", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ status: "cancelled" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/loyalty/enrolments/${ENROLMENT_ID}/status`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "active", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("PATCH /v1/loyalty/enrolments/:id/status — 404 non-existent", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/loyalty/enrolments/${NON_EXISTENT}/status`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "suspended", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// ACCRUALS
// ═══════════════════════════════════════════════════════════════════════════════
describe("Accruals", () => {
  it("POST /v1/loyalty/accrue — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/loyalty/accrue", payload: { enrolmentId: ENROLMENT_ID, points: 100, source: "purchase" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/loyalty/accrue — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/accrue",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, points: 100, source: "purchase" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/loyalty/accrue — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/accrue",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/loyalty/accrue — 201 accrues points", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ status: "active" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/accrue",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, points: 100, source: "purchase", txType: "purchase" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.points).toBe("100");
    expect(H.accrualInsertMock).toHaveBeenCalledOnce();
    expect(H.enrolmentAdjustBalanceMock).toHaveBeenCalledOnce();
  });

  it("POST /v1/loyalty/accrue — 404 when enrolment not found", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/accrue",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: NON_EXISTENT, points: 100, source: "purchase" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/loyalty/accrue — 422 when enrolment not active", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ status: "suspended" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/accrue",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, points: 100, source: "purchase" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("GET /v1/loyalty/enrolments/:id/accruals — 200 lists history", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment());
    H.accrualListByEnrolmentMock.mockResolvedValue({ rows: [{ id: "a1", points: BigInt(100), source: "purchase" }], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/enrolments/${ENROLMENT_ID}/accruals`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/loyalty/enrolments/:id/accruals — 404 for non-existent enrolment", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/enrolments/${NON_EXISTENT}/accruals`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/loyalty/enrolments/:id/balance — 200 returns balance", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment());
    H.accrualGetBalanceSummaryMock.mockResolvedValue({ totalAccrued: BigInt(1000), activePoints: BigInt(800) });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/enrolments/${ENROLMENT_ID}/balance`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.totalAccrued).toBe("1000");
    expect(res.json().data.activePoints).toBe("800");
  });

  it("GET /v1/loyalty/enrolments/:id/balance — 404 for non-existent", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/enrolments/${NON_EXISTENT}/balance`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// REDEMPTIONS
// ═══════════════════════════════════════════════════════════════════════════════
describe("Redemptions", () => {
  it("POST /v1/loyalty/redeem — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/loyalty/redeem", payload: { enrolmentId: ENROLMENT_ID, points: 50, rewardType: "voucher" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/loyalty/redeem — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/redeem",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/loyalty/redeem — 201 redeems points", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ status: "active", pointsBalance: BigInt(500) }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/redeem",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, points: 100, rewardType: "voucher" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("fulfilled");
    expect(H.redemptionInsertMock).toHaveBeenCalledOnce();
  });

  it("POST /v1/loyalty/redeem — 404 when enrolment not found", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/redeem",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: NON_EXISTENT, points: 100, rewardType: "voucher" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/loyalty/redeem — 422 insufficient balance", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ status: "active", pointsBalance: BigInt(50) }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/redeem",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, points: 100, rewardType: "voucher" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("POST /v1/loyalty/redeem — 422 enrolment not active", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ status: "suspended", pointsBalance: BigInt(500) }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/redeem",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, points: 100, rewardType: "voucher" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("POST /v1/loyalty/redemptions/:id/void — 200 voids redemption", async () => {
    H.redemptionFindByIdMock.mockResolvedValue(makeRedemption({ status: "fulfilled", enrolmentId: ENROLMENT_ID }));
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/loyalty/redemptions/${REDEMPTION_ID}/void`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { reason: "Customer request", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("voided");
  });

  it("POST /v1/loyalty/redemptions/:id/void — 404 for non-existent", async () => {
    H.redemptionFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/loyalty/redemptions/${NON_EXISTENT}/void`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { reason: "Error", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/loyalty/redemptions/:id/void — 422 for already voided", async () => {
    H.redemptionFindByIdMock.mockResolvedValue(makeRedemption({ status: "voided" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/loyalty/redemptions/${REDEMPTION_ID}/void`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { reason: "Error", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("POST /v1/loyalty/redemptions/:id/void — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/loyalty/redemptions/${REDEMPTION_ID}/void`,
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { reason: "Error", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/loyalty/redemptions — 200 lists all", async () => {
    H.redemptionListByTenantMock.mockResolvedValue({ rows: [makeRedemption()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/loyalty/redemptions",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/loyalty/redemptions — 200 filters by enrolment", async () => {
    H.redemptionListByEnrolmentMock.mockResolvedValue({ rows: [makeRedemption()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/redemptions?enrolmentId=${ENROLMENT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/loyalty/redemptions/:id — 200 returns redemption", async () => {
    H.redemptionFindByIdMock.mockResolvedValue(makeRedemption());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/redemptions/${REDEMPTION_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(REDEMPTION_ID);
  });

  it("GET /v1/loyalty/redemptions/:id — 404 for non-existent", async () => {
    H.redemptionFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/redemptions/${NON_EXISTENT}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/loyalty/redemptions — 403 for no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/loyalty/redemptions",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TIERS
// ═══════════════════════════════════════════════════════════════════════════════
describe("Tiers", () => {
  it("GET /v1/loyalty/tiers/:enrolmentId — 200 returns current tier", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ tier: "Silver" }));
    H.tierFindCurrentAssignmentMock.mockResolvedValue({
      id: "assign-1",
      tenantId: TENANT,
      enrolmentId: ENROLMENT_ID,
      tierDefinitionId: TIER_DEF_ID,
      assignedAt: new Date(),
      expiresAt: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/tiers/${ENROLMENT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tier).toBe("Silver");
    expect(res.json().data.assignment).not.toBeNull();
  });

  it("GET /v1/loyalty/tiers/:enrolmentId — 200 with no assignment", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ tier: "base" }));
    H.tierFindCurrentAssignmentMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/tiers/${ENROLMENT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.assignment).toBeNull();
  });

  it("GET /v1/loyalty/tiers/:enrolmentId — 404 for non-existent", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/tiers/${NON_EXISTENT}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/loyalty/tiers/:enrolmentId/history — 200 lists history", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment());
    H.tierListAssignmentHistoryMock.mockResolvedValue({ rows: [], total: 0 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/tiers/${ENROLMENT_ID}/history`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(0);
  });

  it("GET /v1/loyalty/tiers/:enrolmentId/history — 404 for non-existent", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/loyalty/tiers/${NON_EXISTENT}/history`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/loyalty/tiers/evaluate — 200 evaluates tier (no change)", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ lifetimePoints: BigInt(100) }));
    H.tierListDefinitionsMock.mockResolvedValue([
      { id: TIER_DEF_ID, tenantId: TENANT, programId: PROGRAM_ID, name: "Bronze", level: 1, minPointsThreshold: BigInt(0), benefits: {}, version: 1, createdAt: new Date(), updatedAt: new Date() },
    ]);
    H.tierFindCurrentAssignmentMock.mockResolvedValue({ tierDefinitionId: TIER_DEF_ID });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/tiers/evaluate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, programId: PROGRAM_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.changed).toBe(false);
  });

  it("POST /v1/loyalty/tiers/evaluate — 200 evaluates tier (upgrade)", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(makeEnrolment({ lifetimePoints: BigInt(600) }));
    H.tierListDefinitionsMock.mockResolvedValue([
      { id: "t1", tenantId: TENANT, programId: PROGRAM_ID, name: "Bronze", level: 1, minPointsThreshold: BigInt(0), benefits: {}, version: 1, createdAt: new Date(), updatedAt: new Date() },
      { id: "t2", tenantId: TENANT, programId: PROGRAM_ID, name: "Silver", level: 2, minPointsThreshold: BigInt(500), benefits: {}, version: 1, createdAt: new Date(), updatedAt: new Date() },
    ]);
    H.tierFindCurrentAssignmentMock.mockResolvedValue({ tierDefinitionId: "t1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/tiers/evaluate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, programId: PROGRAM_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.changed).toBe(true);
    expect(res.json().data.direction).toBe("upgrade");
    expect(res.json().data.newTier).toBe("Silver");
  });

  it("POST /v1/loyalty/tiers/evaluate — 404 for non-existent enrolment", async () => {
    H.enrolmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/tiers/evaluate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { enrolmentId: NON_EXISTENT, programId: PROGRAM_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/loyalty/tiers/evaluate — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/tiers/evaluate",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { enrolmentId: ENROLMENT_ID, programId: PROGRAM_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/loyalty/tiers/evaluate — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/loyalty/tiers/evaluate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
