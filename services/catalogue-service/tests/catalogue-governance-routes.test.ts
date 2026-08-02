/**
 * Route-level coverage for the Sprint 2 governance surface.
 * Mock-based — no real database connection needed (same approach as
 * catalogue-routes.test.ts).
 *
 * Covers PC-001 (versions + maker-checker), PC-002 (lifecycle transitions),
 * PC-003 (regulatory metadata + expiring), PC-007 (public projection).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const MAKER = "00000000-0001-4000-8000-000000000001";
const CHECKER = "00000000-0002-4000-8000-000000000002";
const PRODUCT_ID = "11111111-1111-4000-8000-000000000001";
const VERSION_ID = "55555555-5555-4000-8000-000000000001";
const NON_EXISTENT_ID = "00000000-0000-4000-8000-000000000099";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  // products repo
  productFindByIdMock: vi.fn(),
  productFindByIdsMock: vi.fn(),
  productUpdateMock: vi.fn(),
  // governance repo
  listVersionsMock: vi.fn(),
  findVersionByIdMock: vi.fn(),
  listVersionNumbersMock: vi.fn(),
  insertVersionMock: vi.fn(),
  updateVersionStatusMock: vi.fn(),
  findLatestApprovedVersionMock: vi.fn(),
  productIdsWithApprovedVersionMock: vi.fn(),
  listLifecycleHistoryMock: vi.fn(),
  findCurrentLifecycleMock: vi.fn(),
  insertLifecycleMock: vi.fn(),
  activeLifecycleProductIdsMock: vi.fn(),
  findRegulatoryMock: vi.fn(),
  insertRegulatoryMock: vi.fn(),
  updateRegulatoryMock: vi.fn(),
  listExpiringRegulatoryMock: vi.fn(),
  listAvailabilityV2Mock: vi.fn(),
  replaceAvailabilityV2Mock: vi.fn(),
  listCrossSellMock: vi.fn(),
  findCrossSellByIdMock: vi.fn(),
  insertCrossSellMock: vi.fn(),
  deleteCrossSellMock: vi.fn(),
  // classification repo
  findByProductCodeMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(fn) },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: vi.fn(),
    makeKey: (tenant: string, resource: string, id: string) => `catalogue:${tenant}:${resource}:${id}`,
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/products/repo.js", () => ({
  findById: (...a: unknown[]) => H.productFindByIdMock(...a),
  findByIds: (...a: unknown[]) => H.productFindByIdsMock(...a),
  updateProduct: (...a: unknown[]) => H.productUpdateMock(...a),
  listProducts: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  listByTenant: vi.fn().mockResolvedValue([]),
  insertProduct: vi.fn(),
  softDelete: vi.fn(),
}));

vi.mock("../src/modules/products/governance-repo.js", () => ({
  listVersions: (...a: unknown[]) => H.listVersionsMock(...a),
  findVersionById: (...a: unknown[]) => H.findVersionByIdMock(...a),
  listVersionNumbers: (...a: unknown[]) => H.listVersionNumbersMock(...a),
  insertVersion: (...a: unknown[]) => H.insertVersionMock(...a),
  updateVersionStatus: (...a: unknown[]) => H.updateVersionStatusMock(...a),
  findLatestApprovedVersion: (...a: unknown[]) => H.findLatestApprovedVersionMock(...a),
  productIdsWithApprovedVersion: (...a: unknown[]) => H.productIdsWithApprovedVersionMock(...a),
  listLifecycleHistory: (...a: unknown[]) => H.listLifecycleHistoryMock(...a),
  findCurrentLifecycle: (...a: unknown[]) => H.findCurrentLifecycleMock(...a),
  insertLifecycle: (...a: unknown[]) => H.insertLifecycleMock(...a),
  activeLifecycleProductIds: (...a: unknown[]) => H.activeLifecycleProductIdsMock(...a),
  findRegulatory: (...a: unknown[]) => H.findRegulatoryMock(...a),
  insertRegulatory: (...a: unknown[]) => H.insertRegulatoryMock(...a),
  updateRegulatory: (...a: unknown[]) => H.updateRegulatoryMock(...a),
  listExpiringRegulatory: (...a: unknown[]) => H.listExpiringRegulatoryMock(...a),
  listAvailabilityV2: (...a: unknown[]) => H.listAvailabilityV2Mock(...a),
  replaceAvailabilityV2: (...a: unknown[]) => H.replaceAvailabilityV2Mock(...a),
  listCrossSell: (...a: unknown[]) => H.listCrossSellMock(...a),
  findCrossSellById: (...a: unknown[]) => H.findCrossSellByIdMock(...a),
  insertCrossSell: (...a: unknown[]) => H.insertCrossSellMock(...a),
  deleteCrossSell: (...a: unknown[]) => H.deleteCrossSellMock(...a),
}));

vi.mock("../src/modules/products/classification-repo.js", () => ({
  findByProductCode: (...a: unknown[]) => H.findByProductCodeMock(...a),
}));

import { buildApp } from "../src/app.js";

// ─── Token helpers ────────────────────────────────────────────────────────────
function makerToken(roles: string[] = ["catalogue_admin"]) {
  return signToken({ sub: MAKER, tid: TENANT, roles, sid: "sess-maker" }, SECRET);
}
function checkerToken(roles: string[] = ["catalogue_approver"]) {
  return signToken({ sub: CHECKER, tid: TENANT, roles, sid: "sess-checker" }, SECRET);
}
function readerToken() {
  return signToken({ sub: MAKER, tid: TENANT, roles: ["catalogue_user"], sid: "sess-read" }, SECRET);
}
function noRoleToken() {
  return signToken({ sub: MAKER, tid: TENANT, roles: ["employee"], sid: "sess-none" }, SECRET);
}

// ─── Factories ────────────────────────────────────────────────────────────────
function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    tenantId: TENANT,
    name: "Savings Account",
    description: "Basic savings",
    lineId: null,
    familyId: null,
    parentId: null,
    lifecycleStatus: "active",
    effectiveFrom: null,
    effectiveTo: null,
    regulatoryMetadata: {},
    productCode: "SAV-001",
    category: "deposits",
    taxRateBps: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: MAKER,
    updatedBy: MAKER,
    version: 1,
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    tenantId: TENANT,
    productId: PRODUCT_ID,
    versionNumber: 1,
    status: "draft",
    changeSummary: "Initial draft",
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    createdBy: MAKER,
    createdAt: new Date(),
    submittedAt: null,
    submittedBy: null,
    rejectedBy: null,
    rejectedAt: null,
    updatedAt: new Date(),
    updatedBy: MAKER,
    version: 1,
    ...overrides,
  };
}

function makeLifecycle(overrides: Record<string, unknown> = {}) {
  return {
    id: "66666666-6666-4000-8000-000000000001",
    tenantId: TENANT,
    productId: PRODUCT_ID,
    state: "active",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    reason: null,
    createdBy: MAKER,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeRegulatory(overrides: Record<string, unknown> = {}) {
  return {
    id: "77777777-7777-4000-8000-000000000001",
    tenantId: TENANT,
    productId: PRODUCT_ID,
    regulation: "RBI Master Direction 2016",
    complianceStatus: "compliant",
    notes: null,
    reviewedAt: null,
    reviewerId: MAKER,
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: new Date("2026-12-31T00:00:00Z"),
    createdBy: MAKER,
    createdAt: new Date(),
    updatedBy: MAKER,
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.insertVersionMock.mockResolvedValue(undefined);
  H.updateVersionStatusMock.mockResolvedValue(true);
  H.insertLifecycleMock.mockResolvedValue(undefined);
  H.insertRegulatoryMock.mockResolvedValue(undefined);
  H.updateRegulatoryMock.mockResolvedValue(true);
  H.productUpdateMock.mockResolvedValue(true);
  H.listVersionsMock.mockResolvedValue({ rows: [], total: 0 });
  H.listVersionNumbersMock.mockResolvedValue([]);
  H.listLifecycleHistoryMock.mockResolvedValue([]);
  H.findCurrentLifecycleMock.mockResolvedValue(null);
  H.findRegulatoryMock.mockResolvedValue(null);
  H.listExpiringRegulatoryMock.mockResolvedValue({ rows: [], total: 0 });
  H.dbTransactionMock.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({}));
  // Default cache behaviour: always miss, so the loader runs.
  H.cacheGetOrLoadMock.mockImplementation((_key: string, loader: () => Promise<unknown>) => loader());
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-001 — GET version history
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-001 GET /v1/catalogue/products/:id/versions", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/products/${PRODUCT_ID}/versions` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a token with no catalogue role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid product id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products/not-a-uuid/versions",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 when the product does not exist", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/versions`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 returns history in the list envelope", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listVersionsMock.mockResolvedValue({ rows: [makeVersion(), makeVersion({ versionNumber: 2 })], total: 2 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toEqual({ page: 1, pageSize: 50, total: 2 });
  });

  it("400 when limit exceeds the 200 ceiling", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions?limit=500`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-001 — POST open a draft version
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-001 POST /v1/catalogue/products/:id/versions", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      payload: { changeSummary: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { changeSummary: "Rate revision" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when changeSummary is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 when the product does not exist", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/versions`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { changeSummary: "Rate revision" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 opens version 1 and emits the audit event", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listVersionsMock.mockResolvedValue({ rows: [], total: 0 });
    H.listVersionNumbersMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { changeSummary: "Initial governed version" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("202 numbers the new version max + 1", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listVersionsMock.mockResolvedValue({ rows: [makeVersion({ status: "approved" })], total: 1 });
    H.listVersionNumbersMock.mockResolvedValue([1, 2, 5]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { changeSummary: "Sixth revision" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(res.json().status).toBe("accepted");
  });

  it("422 when a draft is already open", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listVersionsMock.mockResolvedValue({ rows: [makeVersion({ status: "draft" })], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { changeSummary: "Another one" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VERSION_ALREADY_OPEN");
  });

  it("422 when a version is already pending approval", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listVersionsMock.mockResolvedValue({ rows: [makeVersion({ status: "pending_approval" })], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/versions`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { changeSummary: "Another one" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-001 — submit
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-001 POST /v1/catalogue/products/versions/:versionId/submit", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/catalogue/products/versions/${VERSION_ID}/submit`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/submit`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown version", async () => {
    H.findVersionByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${NON_EXISTENT_ID}/submit`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 moves draft to pending_approval", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "draft" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/submit`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(res.json().status).toBe("accepted");
  });

  it("422 when the version is already approved (invalid transition)", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "approved" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/submit`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("202 accepts; version conflict deferred to consumer", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "draft" }));
    H.updateVersionStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/submit`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-001 — approve (MAKER-CHECKER)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-001 POST /v1/catalogue/products/versions/:versionId/approve — maker-checker", () => {
  it("422 when the approver IS the version's creator", async () => {
    // Version created by MAKER; MAKER also holds an approver role and tries to approve.
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "pending_approval", createdBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/approve`,
      headers: { authorization: `Bearer ${makerToken(["catalogue_admin", "catalogue_approver"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    // Critically: nothing was written.
    expect(H.updateVersionStatusMock).not.toHaveBeenCalled();
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("202 when a different actor approves", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "pending_approval", createdBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/approve`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: { comment: "Reviewed against the circular" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(res.json().status).toBe("accepted");
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/catalogue/products/versions/${VERSION_ID}/approve`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a plain catalogue_user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/approve`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown version", async () => {
    H.findVersionByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${NON_EXISTENT_ID}/approve`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("422 when approving a draft that was never submitted", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "draft", createdBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/approve`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("202 accepts; version conflict deferred to consumer", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "pending_approval", createdBy: MAKER }));
    H.updateVersionStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/approve`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-001 — reject
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-001 POST /v1/catalogue/products/versions/:versionId/reject", () => {
  it("400 when the reason is shorter than 10 characters", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "pending_approval", createdBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: { reason: "no" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when the reason is absent entirely", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("422 when the rejecter IS the creator (maker-checker)", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "pending_approval", createdBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      headers: { authorization: `Bearer ${makerToken(["catalogue_approver"])}` },
      payload: { reason: "Withdrawing my own submission" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("202 rejects with a valid reason", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "pending_approval", createdBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: { reason: "Tax rate contradicts the current circular" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(res.json().status).toBe("accepted");
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      payload: { reason: "Long enough reason" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a plain catalogue_user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { reason: "Long enough reason" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown version", async () => {
    H.findVersionByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${NON_EXISTENT_ID}/reject`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: { reason: "Long enough reason" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("422 when rejecting an approved version", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "approved", createdBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: { reason: "Changed our mind about this" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("202 accepts; version conflict deferred to consumer", async () => {
    H.findVersionByIdMock.mockResolvedValue(makeVersion({ status: "pending_approval", createdBy: MAKER }));
    H.updateVersionStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/versions/${VERSION_ID}/reject`,
      headers: { authorization: `Bearer ${checkerToken()}` },
      payload: { reason: "Tax rate contradicts the circular" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-002 — lifecycle
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-002 GET /v1/catalogue/products/:id/lifecycle", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 when the product does not exist", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 returns current state, allowed next states and history", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listLifecycleHistoryMock.mockResolvedValue([makeLifecycle({ state: "active" })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.currentState).toBe("active");
    expect(body.data.allowedNextStates).toEqual(["sunset", "closed_to_new_business", "retired"]);
    expect(body.data.history).toHaveLength(1);
  });

  it("200 with a null current state when no history exists", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listLifecycleHistoryMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.currentState).toBeNull();
    expect(res.json().data.allowedNextStates).toEqual([]);
  });
});

describe("PC-002 POST /v1/catalogue/products/:id/lifecycle", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      payload: { state: "sunset" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { state: "sunset" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a state outside the migration's CHECK allowlist", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "withdrawn" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 when the product does not exist", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "active" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 transitions active → sunset", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findCurrentLifecycleMock.mockResolvedValue(makeLifecycle({ state: "active" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "sunset", reason: "Replaced by SAV-002" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("202 starts an untracked product at active", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findCurrentLifecycleMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "active" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(res.json().status).toBe("accepted");
  });

  it("422 for an INVALID transition (retired is terminal)", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findCurrentLifecycleMock.mockResolvedValue(makeLifecycle({ state: "retired" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "active" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_LIFECYCLE_TRANSITION");
    expect(H.insertLifecycleMock).not.toHaveBeenCalled();
  });

  it("422 for an INVALID transition (reopening a closed product)", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findCurrentLifecycleMock.mockResolvedValue(makeLifecycle({ state: "closed_to_new_business" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "active" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("422 when the product is already in the requested state", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findCurrentLifecycleMock.mockResolvedValue(makeLifecycle({ state: "active" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "active" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("422 when an untracked product tries to start anywhere but active", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findCurrentLifecycleMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/lifecycle`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { state: "retired" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-003 — regulatory metadata
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-003 GET /v1/catalogue/products/:id/regulatory", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 when the product does not exist", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/regulatory`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("404 when no regulatory record exists", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findRegulatoryMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 returns the record", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findRegulatoryMock.mockResolvedValue(makeRegulatory());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.complianceStatus).toBe("compliant");
  });
});

describe("PC-003 PUT /v1/catalogue/products/:id/regulatory", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      payload: { regulation: "RBI MD 2016" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { regulation: "RBI MD 2016" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when regulation is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid complianceStatus", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { regulation: "RBI MD 2016", complianceStatus: "maybe" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 when the product does not exist", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/regulatory`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { regulation: "RBI MD 2016" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 inserts when no record exists", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findRegulatoryMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { regulation: "RBI MD 2016", complianceStatus: "compliant", validUntil: "2026-12-31T00:00:00.000Z" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("202 updates when a record already exists", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findRegulatoryMock.mockResolvedValue(makeRegulatory());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { regulation: "RBI MD 2016 (rev)", complianceStatus: "pending_review" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("422 when validUntil precedes validFrom", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: {
        regulation: "RBI MD 2016",
        validFrom: "2026-06-01T00:00:00.000Z",
        validUntil: "2026-01-01T00:00:00.000Z",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_VALIDITY_WINDOW");
  });

  it("409 when the optimistic lock does not match", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findRegulatoryMock.mockResolvedValue(makeRegulatory());
    H.updateRegulatoryMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/regulatory`,
      headers: { authorization: `Bearer ${makerToken()}` },
      payload: { regulation: "RBI MD 2016", version: 99 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

describe("PC-003 GET /v1/catalogue/regulatory/expiring", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/catalogue/regulatory/expiring" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/regulatory/expiring",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for withinDays=0", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/regulatory/expiring?withinDays=0",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-numeric withinDays", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/regulatory/expiring?withinDays=soon",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("200 defaults to a 30-day window", async () => {
    H.listExpiringRegulatoryMock.mockResolvedValue({ rows: [makeRegulatory()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/regulatory/expiring",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.withinDays).toBe(30);
    expect(body.data).toHaveLength(1);
  });

  it("200 honours an explicit withinDays and passes a cutoff to the repo", async () => {
    H.listExpiringRegulatoryMock.mockResolvedValue({ rows: [], total: 0 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/regulatory/expiring?withinDays=90",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.withinDays).toBe(90);
    const cutoffArg = H.listExpiringRegulatoryMock.mock.calls[0]?.[1] as Date;
    expect(cutoffArg).toBeInstanceOf(Date);
    expect(cutoffArg.getTime()).toBeGreaterThan(Date.now());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-007 — public projection
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-007 GET /v1/catalogue/public/products", () => {
  it("401 without auth — the public surface still requires a JWT", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/catalogue/public/products" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a token with none of the broad read roles", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when limit exceeds 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products?limit=201",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("200 for a portal_user role (broader read set)", async () => {
    H.activeLifecycleProductIdsMock.mockResolvedValue([]);
    H.productIdsWithApprovedVersionMock.mockResolvedValue([]);
    const token = signToken({ sub: MAKER, tid: TENANT, roles: ["portal_user"], sid: "s" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("200 returns only products that are BOTH active and approved", async () => {
    const APPROVED_ACTIVE = PRODUCT_ID;
    const ACTIVE_ONLY = "11111111-1111-4000-8000-000000000002";
    H.activeLifecycleProductIdsMock.mockResolvedValue([APPROVED_ACTIVE, ACTIVE_ONLY]);
    H.productIdsWithApprovedVersionMock.mockResolvedValue([APPROVED_ACTIVE]);
    H.productFindByIdsMock.mockResolvedValue([makeProduct({ id: APPROVED_ACTIVE })]);
    H.findLatestApprovedVersionMock.mockResolvedValue(makeVersion({ status: "approved", versionNumber: 3 }));

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(APPROVED_ACTIVE);
    expect(body.data[0].approvedVersionNumber).toBe(3);
    // The projection must not leak internal audit columns.
    expect(body.data[0].createdBy).toBeUndefined();
    // Only the ids in BOTH sets were fetched.
    expect(H.productFindByIdsMock).toHaveBeenCalledWith([APPROVED_ACTIVE], TENANT);
  });

  it("200 excludes an approved product whose lifecycle is not active", async () => {
    H.activeLifecycleProductIdsMock.mockResolvedValue([]); // nothing active
    H.productIdsWithApprovedVersionMock.mockResolvedValue([PRODUCT_ID]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("200 reads cache-first via getOrLoad", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue([
      { id: PRODUCT_ID, productCode: "SAV-001", name: "Cached", description: null, category: "deposits", taxRateBps: 1800, lifecycleState: "active", approvedVersionNumber: 1, effectiveFrom: null, effectiveTo: null },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].name).toBe("Cached");
    expect(H.cacheGetOrLoadMock).toHaveBeenCalledOnce();
    // A cache hit means the DB loaders were never touched.
    expect(H.activeLifecycleProductIdsMock).not.toHaveBeenCalled();
  });

  it("200 filters by category and paginates within the cached projection", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue([
      { id: "a", productCode: "A", name: "A", description: null, category: "deposits", taxRateBps: 0, lifecycleState: "active", approvedVersionNumber: 1, effectiveFrom: null, effectiveTo: null },
      { id: "b", productCode: "B", name: "B", description: null, category: "loans", taxRateBps: 0, lifecycleState: "active", approvedVersionNumber: 1, effectiveFrom: null, effectiveTo: null },
      { id: "c", productCode: "C", name: "C", description: null, category: "deposits", taxRateBps: 0, lifecycleState: "active", approvedVersionNumber: 1, effectiveFrom: null, effectiveTo: null },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products?category=deposits&limit=1&offset=1",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("c");
    expect(body.meta).toEqual({ page: 2, pageSize: 1, total: 2 });
  });

  it("200 tolerates a null cache result", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("skips a product whose approved version vanished between reads", async () => {
    H.activeLifecycleProductIdsMock.mockResolvedValue([PRODUCT_ID]);
    H.productIdsWithApprovedVersionMock.mockResolvedValue([PRODUCT_ID]);
    H.productFindByIdsMock.mockResolvedValue([makeProduct()]);
    H.findLatestApprovedVersionMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("PC-007 GET /v1/catalogue/public/products/:id", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/public/products/${PRODUCT_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/public/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/public/products/nope",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("200 returns the single projection", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue([
      { id: PRODUCT_ID, productCode: "SAV-001", name: "Savings", description: null, category: "deposits", taxRateBps: 1800, lifecycleState: "active", approvedVersionNumber: 2, effectiveFrom: null, effectiveTo: null },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/public/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.approvedVersionNumber).toBe(2);
  });

  it("404 when the product is not publishable", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/public/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
