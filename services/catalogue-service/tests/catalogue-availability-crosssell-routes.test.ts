/**
 * Route-level coverage for PC-004 (availability-v2 + most-specific-wins lookup),
 * PC-005 (rate external masters), PC-008 (cross-sell + self-reference guard) and
 * QP-001 (product code / category / tax rate in basis points).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const ACTOR = "00000000-0001-4000-8000-000000000001";
const PRODUCT_ID = "11111111-1111-4000-8000-000000000001";
const TARGET_ID = "11111111-1111-4000-8000-000000000002";
const RATE_ID = "22222222-2222-4000-8000-000000000001";
const RULE_ID = "88888888-8888-4000-8000-000000000001";
const NON_EXISTENT_ID = "00000000-0000-4000-8000-000000000099";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  productFindByIdMock: vi.fn(),
  productUpdateMock: vi.fn(),
  listAvailabilityV2Mock: vi.fn(),
  replaceAvailabilityV2Mock: vi.fn(),
  listCrossSellMock: vi.fn(),
  findCrossSellByIdMock: vi.fn(),
  insertCrossSellMock: vi.fn(),
  deleteCrossSellMock: vi.fn(),
  rateFindByIdMock: vi.fn(),
  listExternalRefsMock: vi.fn(),
  setExternalRefMock: vi.fn(),
  findByProductCodeMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(fn) },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn().mockResolvedValue([]),
    invalidate: vi.fn(),
    makeKey: (t: string, r: string, i: string) => `catalogue:${t}:${r}:${i}`,
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/products/repo.js", () => ({
  findById: (...a: unknown[]) => H.productFindByIdMock(...a),
  updateProduct: (...a: unknown[]) => H.productUpdateMock(...a),
  findByIds: vi.fn().mockResolvedValue([]),
  listProducts: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  listByTenant: vi.fn().mockResolvedValue([]),
  insertProduct: vi.fn(),
  softDelete: vi.fn(),
}));

vi.mock("../src/modules/products/governance-repo.js", () => ({
  listAvailabilityV2: (...a: unknown[]) => H.listAvailabilityV2Mock(...a),
  replaceAvailabilityV2: (...a: unknown[]) => H.replaceAvailabilityV2Mock(...a),
  listCrossSell: (...a: unknown[]) => H.listCrossSellMock(...a),
  findCrossSellById: (...a: unknown[]) => H.findCrossSellByIdMock(...a),
  insertCrossSell: (...a: unknown[]) => H.insertCrossSellMock(...a),
  deleteCrossSell: (...a: unknown[]) => H.deleteCrossSellMock(...a),
  listVersions: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  findVersionById: vi.fn().mockResolvedValue(null),
  listVersionNumbers: vi.fn().mockResolvedValue([]),
  insertVersion: vi.fn(),
  updateVersionStatus: vi.fn().mockResolvedValue(true),
  findLatestApprovedVersion: vi.fn().mockResolvedValue(null),
  productIdsWithApprovedVersion: vi.fn().mockResolvedValue([]),
  listLifecycleHistory: vi.fn().mockResolvedValue([]),
  findCurrentLifecycle: vi.fn().mockResolvedValue(null),
  insertLifecycle: vi.fn(),
  activeLifecycleProductIds: vi.fn().mockResolvedValue([]),
  findRegulatory: vi.fn().mockResolvedValue(null),
  insertRegulatory: vi.fn(),
  updateRegulatory: vi.fn().mockResolvedValue(true),
  listExpiringRegulatory: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

vi.mock("../src/modules/rates/repo.js", () => ({
  findById: (...a: unknown[]) => H.rateFindByIdMock(...a),
  listRates: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  findCurrentRate: vi.fn().mockResolvedValue(null),
  insertRate: vi.fn(),
  updateRate: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/modules/rates/external-ref-repo.js", () => ({
  listExternalRefs: (...a: unknown[]) => H.listExternalRefsMock(...a),
  setExternalRef: (...a: unknown[]) => H.setExternalRefMock(...a),
}));

vi.mock("../src/modules/products/classification-repo.js", () => ({
  findByProductCode: (...a: unknown[]) => H.findByProductCodeMock(...a),
}));

import { buildApp } from "../src/app.js";
import { MAX_AVAILABILITY_ROWS } from "../src/modules/products/availability-v2-routes.js";

function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["catalogue_admin"], sid: "s1" }, SECRET);
}
function readerToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["catalogue_user"], sid: "s2" }, SECRET);
}
function noRoleToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["employee"], sid: "s3" }, SECRET);
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    tenantId: TENANT,
    name: "Savings",
    description: null,
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
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function makeAvailability(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-9999-4000-8000-000000000001",
    tenantId: TENANT,
    productId: PRODUCT_ID,
    circleCode: null,
    regionCode: null,
    officeCode: null,
    available: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdBy: ACTOR,
    createdAt: new Date(),
    updatedBy: ACTOR,
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

function makeRate(overrides: Record<string, unknown> = {}) {
  return {
    id: RATE_ID,
    tenantId: TENANT,
    productId: PRODUCT_ID,
    effectiveDate: "2026-01-01",
    effectiveTo: null,
    rateValue: 5000n,
    source: "RBI Circular",
    sourceSystem: null,
    externalId: null,
    syncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function makeCrossSell(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    tenantId: TENANT,
    sourceProductId: PRODUCT_ID,
    targetProductId: TARGET_ID,
    ruleType: "cross_sell",
    priority: 10,
    enabled: true,
    note: null,
    createdBy: ACTOR,
    createdAt: new Date(),
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.enqueueMock.mockResolvedValue(undefined);
  H.replaceAvailabilityV2Mock.mockImplementation((_tx: unknown, _p: string, _t: string, rows: unknown[]) => Promise.resolve(rows.length));
  H.listAvailabilityV2Mock.mockResolvedValue([]);
  H.listCrossSellMock.mockResolvedValue([]);
  H.insertCrossSellMock.mockResolvedValue(undefined);
  H.deleteCrossSellMock.mockResolvedValue(true);
  H.setExternalRefMock.mockResolvedValue(true);
  H.listExternalRefsMock.mockResolvedValue({ rows: [], total: 0 });
  H.productUpdateMock.mockResolvedValue(true);
  H.findByProductCodeMock.mockResolvedValue(null);
  H.dbTransactionMock.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({}));
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-004 — list + bulk set
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-004 GET /v1/catalogue/products/:id/availability-v2", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products/xyz/availability-v2",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown product", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 lists availability rows", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([
      makeAvailability({ circleCode: "KA" }),
      makeAvailability({ circleCode: "KA", regionCode: "BLR", available: false }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
    expect(res.json().meta.total).toBe(2);
  });
});

describe("PC-004 PUT /v1/catalogue/products/:id/availability-v2", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      payload: { rows: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { rows: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when rows is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it(`400 when more than ${MAX_AVAILABILITY_ROWS} rows are supplied`, async () => {
    const rows = Array.from({ length: MAX_AVAILABILITY_ROWS + 1 }, (_, i) => ({
      circleCode: `C${i}`,
      available: true,
    }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rows },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it(`202 accepts exactly ${MAX_AVAILABILITY_ROWS} rows (boundary)`, async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const rows = Array.from({ length: MAX_AVAILABILITY_ROWS }, (_, i) => ({
      circleCode: `C${i}`,
      available: true,
    }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rows },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.rowCount).toBe(MAX_AVAILABILITY_ROWS);
  });

  it("404 for an unknown product", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rows: [{ circleCode: "KA", available: true }] },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 replaces the availability set and emits an event", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        rows: [
          { circleCode: "KA", available: true },
          { circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: false },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.rowCount).toBe(2);
    expect(H.replaceAvailabilityV2Mock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
  });

  it("202 accepts an empty set (clears availability)", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rows: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.rowCount).toBe(0);
  });

  it("422 when officeCode is given without regionCode", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rows: [{ circleCode: "KA", officeCode: "BLR-001", available: true }] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_AVAILABILITY_SCOPE");
  });

  it("422 when regionCode is given without circleCode", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rows: [{ regionCode: "BLR", available: true }] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("422 when effectiveTo precedes effectiveFrom", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability-v2`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        rows: [{
          circleCode: "KA",
          available: true,
          effectiveFrom: "2026-06-01T00:00:00.000Z",
          effectiveTo: "2026-01-01T00:00:00.000Z",
        }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_EFFECTIVE_WINDOW");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-004 — most-specific-wins lookup (the headline behaviour)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-004 GET /v1/catalogue/availability/lookup — most-specific-wins", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when productId is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/availability/lookup?circleId=KA",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when productId is not a uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/availability/lookup?productId=abc",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown product", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 denies by default when the product has no availability rows", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}&circleId=KA`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.available).toBe(false);
    expect(res.json().data.matchedRule).toBeNull();
  });

  it("200 — an OFFICE deny beats a CIRCLE allow (most-specific-wins)", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([
      makeAvailability({ circleCode: "KA", available: true }),
      makeAvailability({ circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: false }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}&circleId=KA&regionId=BLR&officeId=BLR-001`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.available).toBe(false);
    expect(data.matchedRule.officeCode).toBe("BLR-001");
    expect(data.specificity).toBe(7);
    expect(data.candidateCount).toBe(2);
  });

  it("200 — an OFFICE allow beats a CIRCLE deny", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([
      makeAvailability({ circleCode: "KA", available: false }),
      makeAvailability({ circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: true }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}&circleId=KA&regionId=BLR&officeId=BLR-001`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.json().data.available).toBe(true);
  });

  it("200 — falls back to the broader rule when the narrow rule is for another office", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([
      makeAvailability({ circleCode: "KA", available: true }),
      makeAvailability({ circleCode: "KA", regionCode: "MYS", officeCode: "MYS-007", available: false }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}&circleId=KA&regionId=BLR&officeId=BLR-001`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    const data = res.json().data;
    expect(data.available).toBe(true);
    expect(data.candidateCount).toBe(1);
    expect(data.specificity).toBe(1);
  });

  it("200 — a REGION rule beats a CIRCLE rule", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([
      makeAvailability({ circleCode: "KA", available: true }),
      makeAvailability({ circleCode: "KA", regionCode: "BLR", available: false }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}&circleId=KA&regionId=BLR`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    const data = res.json().data;
    expect(data.available).toBe(false);
    expect(data.matchedRule.regionCode).toBe("BLR");
    expect(data.specificity).toBe(3);
  });

  it("200 — a tenant-wide wildcard row answers a bare lookup", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([makeAvailability({ available: true })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.json().data.available).toBe(true);
    expect(res.json().data.specificity).toBe(0);
  });

  it("200 — an expired row does not grant availability", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([
      makeAvailability({ circleCode: "KA", available: true, effectiveTo: new Date("2020-01-01T00:00:00Z") }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}&circleId=KA`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.json().data.available).toBe(false);
  });

  it("200 echoes the query levels back", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listAvailabilityV2Mock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/availability/lookup?productId=${PRODUCT_ID}&circleId=KA&regionId=BLR`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.json().data.query).toEqual({ circleId: "KA", regionId: "BLR", officeId: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-008 — cross-sell
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-008 GET /v1/catalogue/products/:id/cross-sell", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid product id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products/bad/cross-sell",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown product", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 lists rules", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listCrossSellMock.mockResolvedValue([makeCrossSell()]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("200 passes enabledOnly through to the repo", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.listCrossSellMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell?enabledOnly=true`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(H.listCrossSellMock).toHaveBeenCalledWith(PRODUCT_ID, TENANT, true);
  });
});

describe("PC-008 POST /v1/catalogue/products/:id/cross-sell", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      payload: { targetProductId: TARGET_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { targetProductId: TARGET_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when targetProductId is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid ruleType", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { targetProductId: TARGET_ID, ruleType: "bundle" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("422 when a product cross-sells ITSELF", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { targetProductId: PRODUCT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SELF_CROSS_SELL");
    // Nothing was written and no product lookup was even needed.
    expect(H.insertCrossSellMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });

  it("422 self cross-sell is rejected for every rule type", async () => {
    for (const ruleType of ["cross_sell", "upsell", "complementary"]) {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { targetProductId: PRODUCT_ID, ruleType },
      });
      await app.close();
      expect(res.statusCode).toBe(422);
    }
  });

  it("404 when the source product does not exist", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { targetProductId: TARGET_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("404 when the target product does not exist", async () => {
    H.productFindByIdMock.mockImplementation((id: string) =>
      Promise.resolve(id === PRODUCT_ID ? makeProduct() : null));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { targetProductId: NON_EXISTENT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("201 creates the rule", async () => {
    H.productFindByIdMock.mockImplementation((id: string) => Promise.resolve(makeProduct({ id })));
    H.listCrossSellMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { targetProductId: TARGET_ID, ruleType: "upsell", priority: 5 },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.targetProductId).toBe(TARGET_ID);
    expect(H.insertCrossSellMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
  });

  it("422 for a duplicate pair + rule type", async () => {
    H.productFindByIdMock.mockImplementation((id: string) => Promise.resolve(makeProduct({ id })));
    H.listCrossSellMock.mockResolvedValue([makeCrossSell({ targetProductId: TARGET_ID, ruleType: "cross_sell" })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/cross-sell`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { targetProductId: TARGET_ID, ruleType: "cross_sell" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("DUPLICATE_CROSS_SELL");
  });
});

describe("PC-008 DELETE /v1/catalogue/cross-sell/:ruleId", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/v1/catalogue/cross-sell/${RULE_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/cross-sell/${RULE_ID}`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid rule id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/catalogue/cross-sell/nope",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown rule", async () => {
    H.findCrossSellByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/cross-sell/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 deletes the rule and emits an event", async () => {
    H.findCrossSellByIdMock.mockResolvedValue(makeCrossSell());
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/cross-sell/${RULE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.deleted).toBe(true);
    expect(H.deleteCrossSellMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
  });

  it("409 when the rule vanished mid-transaction", async () => {
    H.findCrossSellByIdMock.mockResolvedValue(makeCrossSell());
    H.deleteCrossSellMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/cross-sell/${RULE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-005 — rate external masters
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-005 GET /v1/catalogue/rates/external-refs", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/catalogue/rates/external-refs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/rates/external-refs",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when limit exceeds 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/rates/external-refs?limit=1000",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("200 lists externally-mastered rates with money as a STRING", async () => {
    H.listExternalRefsMock.mockResolvedValue({
      rows: [makeRate({ sourceSystem: "FINACLE", externalId: "RT-9001", rateValue: 9007199254740993n })],
      total: 1,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/rates/external-refs",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const row = res.json().data[0];
    expect(row.sourceSystem).toBe("FINACLE");
    // bigint above 2^53 survives as an exact string.
    expect(row.rateValueMinor).toBe("9007199254740993");
    expect(typeof row.rateValueMinor).toBe("string");
  });

  it("200 passes a sourceSystem filter through", async () => {
    H.listExternalRefsMock.mockResolvedValue({ rows: [], total: 0 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/rates/external-refs?sourceSystem=CBS",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(H.listExternalRefsMock).toHaveBeenCalledWith(expect.objectContaining({ sourceSystem: "CBS" }));
  });
});

describe("PC-005 PUT /v1/catalogue/rates/:id/external-ref", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${RATE_ID}/external-ref`,
      payload: { sourceSystem: "CBS", externalId: "X" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${RATE_ID}/external-ref`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { sourceSystem: "CBS", externalId: "X" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when sourceSystem is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${RATE_ID}/external-ref`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { externalId: "X" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown rate", async () => {
    H.rateFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${NON_EXISTENT_ID}/external-ref`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { sourceSystem: "CBS", externalId: "RT-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 records the external master", async () => {
    H.rateFindByIdMock.mockResolvedValue(makeRate());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${RATE_ID}/external-ref`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { sourceSystem: "FINACLE", externalId: "RT-9001", syncedAt: "2026-06-01T00:00:00.000Z" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sourceSystem).toBe("FINACLE");
    expect(res.json().data.version).toBe(2);
    expect(H.setExternalRefMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
  });

  it("200 defaults syncedAt to now when omitted", async () => {
    H.rateFindByIdMock.mockResolvedValue(makeRate());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${RATE_ID}/external-ref`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { sourceSystem: "CBS", externalId: "RT-2" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.syncedAt).toBeDefined();
  });

  it("422 when syncedAt is in the future", async () => {
    H.rateFindByIdMock.mockResolvedValue(makeRate());
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${RATE_ID}/external-ref`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { sourceSystem: "CBS", externalId: "RT-3", syncedAt: future },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_SYNCED_AT");
  });

  it("409 when the optimistic lock does not match", async () => {
    H.rateFindByIdMock.mockResolvedValue(makeRate());
    H.setExternalRefMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/rates/${RATE_ID}/external-ref`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { sourceSystem: "CBS", externalId: "RT-4", version: 99 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QP-001 — product code / category / tax rate (basis points)
// ═══════════════════════════════════════════════════════════════════════════════
describe("QP-001 GET /v1/catalogue/products/:id/classification", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/products/${PRODUCT_ID}/classification` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown product", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/classification`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 returns code, category and an INTEGER tax rate in basis points", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct({ productCode: "SAV-001", category: "deposits", taxRateBps: 1800 }));
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.productCode).toBe("SAV-001");
    expect(data.category).toBe("deposits");
    expect(data.taxRateBps).toBe(1800);
    expect(Number.isInteger(data.taxRateBps)).toBe(true);
  });
});

describe("QP-001 PUT /v1/catalogue/products/:id/classification", () => {
  const VALID = { productCode: "SAV-002", category: "deposits", taxRateBps: 1200 };

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when taxRateBps is a float (basis points must be an integer)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, taxRateBps: 12.5 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when taxRateBps exceeds 10000 (100%)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, taxRateBps: 10001 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when taxRateBps is negative", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, taxRateBps: -1 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a productCode with illegal characters", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, productCode: "bad code!" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when category is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { productCode: "SAV-002", taxRateBps: 1200 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown product", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 sets the classification", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findByProductCodeMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.taxRateBps).toBe(1200);
    expect(res.json().data.version).toBe(2);
    expect(H.productUpdateMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
  });

  it("200 accepts a 0 bps (tax-exempt) product", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, taxRateBps: 0 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.taxRateBps).toBe(0);
  });

  it("200 allows a product to keep its own existing code", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findByProductCodeMock.mockResolvedValue(makeProduct({ id: PRODUCT_ID }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("422 when the productCode belongs to another product", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.findByProductCodeMock.mockResolvedValue(makeProduct({ id: TARGET_ID }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("DUPLICATE_PRODUCT_CODE");
  });

  it("409 when the optimistic lock does not match", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.productUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/products/${PRODUCT_ID}/classification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, version: 99 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });
});

describe("QP-001 GET /v1/catalogue/products/by-code/:productCode", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/catalogue/products/by-code/SAV-001" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products/by-code/SAV-001",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown code", async () => {
    H.findByProductCodeMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products/by-code/NOPE-999",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 returns the product", async () => {
    H.findByProductCodeMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products/by-code/SAV-001",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(PRODUCT_ID);
    expect(H.findByProductCodeMock).toHaveBeenCalledWith("SAV-001", TENANT);
  });
});
