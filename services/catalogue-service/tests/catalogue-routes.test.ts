/**
 * Route-level coverage tests for catalogue-service.
 * Mock-based approach — no real database connection needed.
 * Covers products (CRUD + lifecycle), rates (create + effective-date lookup),
 * eligibility (check + rule management), and bundles (CRUD + validation).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const ACTOR = "00000000-0001-4000-8000-000000000001";
const PRODUCT_ID = "11111111-1111-4000-8000-000000000001";
const RATE_ID = "22222222-2222-4000-8000-000000000001";
const RULE_ID = "33333333-3333-4000-8000-000000000001";
const BUNDLE_ID = "44444444-4444-4000-8000-000000000001";
const NON_EXISTENT_ID = "00000000-0000-4000-8000-000000000099";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  // DB
  dbInsertMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  dbSelectMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  // Products repo
  productFindByIdMock: vi.fn(),
  productListMock: vi.fn(),
  productListByTenantMock: vi.fn(),
  productInsertMock: vi.fn(),
  productUpdateMock: vi.fn(),
  productSoftDeleteMock: vi.fn(),
  productFindByIdsMock: vi.fn(),
  // Rates repo
  rateFindByIdMock: vi.fn(),
  rateListMock: vi.fn(),
  rateFindCurrentMock: vi.fn(),
  rateInsertMock: vi.fn(),
  rateUpdateMock: vi.fn(),
  // Eligibility repo
  eligFindByIdMock: vi.fn(),
  eligListByProductMock: vi.fn(),
  eligListByProductsMock: vi.fn(),
  eligInsertRuleMock: vi.fn(),
  eligDeleteRuleMock: vi.fn(),
  // Bundles repo
  bundleFindByIdMock: vi.fn(),
  bundleListMock: vi.fn(),
  bundleInsertMock: vi.fn(),
  bundleUpdateMock: vi.fn(),
  bundleSoftDeleteMock: vi.fn(),
  // Outbox
  enqueueMock: vi.fn(),
  // Infra
}));

// ─── vi.mock declarations ─────────────────────────────────────────────────────
vi.mock("../src/shared/db.js", () => ({
  db: {
    insert: (...a: unknown[]) => H.dbInsertMock(...a),
    update: (...a: unknown[]) => H.dbUpdateMock(...a),
    select: (...a: unknown[]) => H.dbSelectMock(...a),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(fn),
  },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(),
    invalidate: vi.fn(),
    makeKey: vi.fn().mockReturnValue("cache-key"),
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/products/repo.js", () => ({
  findById: (...a: unknown[]) => H.productFindByIdMock(...a),
  listProducts: (...a: unknown[]) => H.productListMock(...a),
  listByTenant: (...a: unknown[]) => H.productListByTenantMock(...a),
  insertProduct: (...a: unknown[]) => H.productInsertMock(...a),
  updateProduct: (...a: unknown[]) => H.productUpdateMock(...a),
  softDelete: (...a: unknown[]) => H.productSoftDeleteMock(...a),
  findByIds: (...a: unknown[]) => H.productFindByIdsMock(...a),
}));

vi.mock("../src/modules/rates/repo.js", () => ({
  findById: (...a: unknown[]) => H.rateFindByIdMock(...a),
  listRates: (...a: unknown[]) => H.rateListMock(...a),
  findCurrentRate: (...a: unknown[]) => H.rateFindCurrentMock(...a),
  insertRate: (...a: unknown[]) => H.rateInsertMock(...a),
  updateRate: (...a: unknown[]) => H.rateUpdateMock(...a),
}));

vi.mock("../src/modules/eligibility/repo.js", () => ({
  findById: (...a: unknown[]) => H.eligFindByIdMock(...a),
  listByProduct: (...a: unknown[]) => H.eligListByProductMock(...a),
  listByProducts: (...a: unknown[]) => H.eligListByProductsMock(...a),
  insertRule: (...a: unknown[]) => H.eligInsertRuleMock(...a),
  deleteRule: (...a: unknown[]) => H.eligDeleteRuleMock(...a),
}));

vi.mock("../src/modules/bundles/repo.js", () => ({
  findById: (...a: unknown[]) => H.bundleFindByIdMock(...a),
  listBundles: (...a: unknown[]) => H.bundleListMock(...a),
  insertBundle: (...a: unknown[]) => H.bundleInsertMock(...a),
  updateBundle: (...a: unknown[]) => H.bundleUpdateMock(...a),
  softDeleteBundle: (...a: unknown[]) => H.bundleSoftDeleteMock(...a),
}));

import { buildApp } from "../src/app.js";
import { EVENTS } from "../src/topics.js";

// ─── Token helpers ────────────────────────────────────────────────────────────
function adminToken(roles: string[] = ["catalogue_admin", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}
function userToken(roles: string[] = ["catalogue_user"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-002" }, SECRET);
}
function noRoleToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["employee"], sid: "sess-003" }, SECRET);
}

// ─── Factory helpers ──────────────────────────────────────────────────────────
function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    tenantId: TENANT,
    name: "Savings Account",
    description: "Basic savings product",
    lineId: null,
    familyId: null,
    parentId: null,
    lifecycleStatus: "draft",
    effectiveFrom: null,
    effectiveTo: null,
    regulatoryMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function makeRate(overrides: Record<string, unknown> = {}) {
  return {
    id: RATE_ID,
    tenantId: TENANT,
    productId: PRODUCT_ID,
    effectiveDate: "2025-01-01",
    effectiveTo: null,
    rateValue: BigInt(5000),
    source: "RBI Circular",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    tenantId: TENANT,
    productId: PRODUCT_ID,
    ruleType: "age_range",
    criteria: { minAge: 18, maxAge: 65 },
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function makeBundle(overrides: Record<string, unknown> = {}) {
  return {
    id: BUNDLE_ID,
    tenantId: TENANT,
    name: "Savings Bundle",
    description: "A bundle",
    componentProductIds: [PRODUCT_ID],
    pricingApprovalRequired: false,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

// ─── beforeEach reset ─────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // Default: all write mocks resolve
  H.productInsertMock.mockResolvedValue(undefined);
  H.productUpdateMock.mockResolvedValue(true);
  H.productSoftDeleteMock.mockResolvedValue(true);
  H.rateInsertMock.mockResolvedValue(undefined);
  H.rateUpdateMock.mockResolvedValue(true);
  H.eligInsertRuleMock.mockResolvedValue(undefined);
  H.eligDeleteRuleMock.mockResolvedValue(true);
  H.bundleInsertMock.mockResolvedValue(undefined);
  H.bundleUpdateMock.mockResolvedValue(true);
  H.bundleSoftDeleteMock.mockResolvedValue(true);
  H.enqueueMock.mockResolvedValue(undefined);
  H.dbInsertMock.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  H.dbUpdateMock.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
  H.dbSelectMock.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
  // Mutating routes now wrap the repo write + outbox enqueue in db.transaction().
  H.dbTransactionMock.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: (...a: unknown[]) => H.dbInsertMock(...a),
      update: (...a: unknown[]) => H.dbUpdateMock(...a),
      select: (...a: unknown[]) => H.dbSelectMock(...a),
    }),
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════
describe("Products CRUD", () => {
  it("POST /v1/catalogue/products — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/catalogue/products", payload: { name: "Test" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/catalogue/products — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/products",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { name: "Test Product" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/catalogue/products — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/products",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/catalogue/products — 201 creates product", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/products",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Savings Account", description: "Basic savings", lifecycleStatus: "draft" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(H.productInsertMock).toHaveBeenCalledOnce();
  });

  it("GET /v1/catalogue/products — 200 lists products", async () => {
    H.productListMock.mockResolvedValue({ rows: [makeProduct()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });

  it("GET /v1/catalogue/products — 403 for no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/catalogue/products/:id — 200 returns product", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(PRODUCT_ID);
  });

  it("GET /v1/catalogue/products/:id — 404 for non-existent", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/catalogue/products/tree — 200 returns tree", async () => {
    H.productListByTenantMock.mockResolvedValue([makeProduct()]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/products/tree",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
});

describe("Products lifecycle transitions", () => {
  it("PATCH — valid transition draft→active succeeds", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct({ lifecycleStatus: "draft" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { lifecycleStatus: "active" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(H.productUpdateMock).toHaveBeenCalledOnce();
  });

  it("PATCH — invalid transition draft→withdrawn returns 422", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct({ lifecycleStatus: "draft" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { lifecycleStatus: "withdrawn" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("PATCH — non-existent product returns 404", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("PATCH — edit non-editable product returns 422", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct({ lifecycleStatus: "withdrawn" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "New Name" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("DELETE /v1/catalogue/products/:id — 200 soft deletes (withdraws)", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.lifecycleStatus).toBe("withdrawn");
    expect(H.productSoftDeleteMock).toHaveBeenCalledOnce();
  });

  it("DELETE /v1/catalogue/products/:id — 404 for non-existent", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/catalogue/products/:id — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("Product availability", () => {
  it("POST /v1/catalogue/products/:id/availability — 201 sets availability", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { circleId: "11111111-1111-4000-8000-111111111111", available: true },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.productId).toBe(PRODUCT_ID);
  });

  it("POST /v1/catalogue/products/:id/availability — 404 for non-existent product", async () => {
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${NON_EXISTENT_ID}/availability`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { circleId: "11111111-1111-4000-8000-111111111111", available: true },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/catalogue/products/:id/availability — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability`,
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { circleId: "11111111-1111-4000-8000-111111111111", available: true },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RATES
// ═══════════════════════════════════════════════════════════════════════════════
describe("Rates", () => {
  it("POST /v1/catalogue/rates — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/catalogue/rates", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/catalogue/rates — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/rates",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { productId: PRODUCT_ID, effectiveFrom: "2025-01-01", rateValueMinor: "5000", source: "RBI" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/catalogue/rates — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/rates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/catalogue/rates — 201 creates rate", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/rates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { productId: PRODUCT_ID, effectiveFrom: "2025-01-01", rateValueMinor: "5000", source: "RBI Circular" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
    expect(H.rateInsertMock).toHaveBeenCalledOnce();
  });

  it("GET /v1/catalogue/rates — 200 lists rates for product", async () => {
    H.rateListMock.mockResolvedValue({ rows: [makeRate()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/rates?productId=${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/catalogue/rates — 403 for no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/rates?productId=${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/catalogue/rates/current — 200 returns current rate", async () => {
    H.rateFindCurrentMock.mockResolvedValue(makeRate());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/rates/current?productId=${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("GET /v1/catalogue/rates/current — 404 when no rate exists", async () => {
    H.rateFindCurrentMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/rates/current?productId=${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/catalogue/rates/:id — 200 updates rate", async () => {
    H.rateFindByIdMock.mockResolvedValue(makeRate());
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/rates/${RATE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rateValueMinor: "9999" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(2);
    expect(H.rateUpdateMock).toHaveBeenCalledOnce();
  });

  it("PATCH /v1/catalogue/rates/:id — 404 for non-existent", async () => {
    H.rateFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/rates/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rateValueMinor: "9999" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/catalogue/rates/:id — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/rates/${RATE_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { rateValueMinor: "9999" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ELIGIBILITY
// ═══════════════════════════════════════════════════════════════════════════════
describe("Eligibility rules + check", () => {
  it("POST /v1/catalogue/eligibility/rules — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/catalogue/eligibility/rules", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/catalogue/eligibility/rules — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/rules",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { productId: PRODUCT_ID, ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/catalogue/eligibility/rules — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/rules",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/catalogue/eligibility/rules — 201 creates rule", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/rules",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { productId: PRODUCT_ID, ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
    expect(H.eligInsertRuleMock).toHaveBeenCalledOnce();
  });

  it("GET /v1/catalogue/eligibility/rules — 200 lists rules", async () => {
    H.eligListByProductMock.mockResolvedValue([makeRule()]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/eligibility/rules?productId=${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/catalogue/eligibility/rules — 403 for no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/eligibility/rules?productId=${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/catalogue/eligibility/rules/:id — 200 deletes rule", async () => {
    H.eligFindByIdMock.mockResolvedValue(makeRule());
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/eligibility/rules/${RULE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("deleted");
    expect(H.eligDeleteRuleMock).toHaveBeenCalledOnce();
  });

  it("DELETE /v1/catalogue/eligibility/rules/:id — 404 for non-existent", async () => {
    H.eligFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/eligibility/rules/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/catalogue/eligibility/rules/:id — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/eligibility/rules/${RULE_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/catalogue/eligibility/check — 200 eligible case", async () => {
    H.eligListByProductsMock.mockResolvedValue([
      makeRule({ productId: PRODUCT_ID, ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/check",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { customerAttributes: { age: 30 }, productIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.eligibleProductIds).toContain(PRODUCT_ID);
  });

  it("POST /v1/catalogue/eligibility/check — 200 ineligible case", async () => {
    H.eligListByProductsMock.mockResolvedValue([
      makeRule({ productId: PRODUCT_ID, ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/check",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { customerAttributes: { age: 16 }, productIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.eligibleProductIds).not.toContain(PRODUCT_ID);
  });

  it("POST /v1/catalogue/eligibility/check — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/check",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/catalogue/eligibility/check — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/check",
      payload: { customerAttributes: { age: 30 }, productIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUNDLES
// ═══════════════════════════════════════════════════════════════════════════════
describe("Bundles CRUD + validation", () => {
  it("POST /v1/catalogue/bundles — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/catalogue/bundles", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/catalogue/bundles — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/bundles",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { name: "Bundle", componentProductIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/catalogue/bundles — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/bundles",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/catalogue/bundles — 422 when components not active", async () => {
    H.productFindByIdsMock.mockResolvedValue([makeProduct({ lifecycleStatus: "draft" })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/bundles",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Bad Bundle", componentProductIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("POST /v1/catalogue/bundles — 201 creates bundle with active components", async () => {
    H.productFindByIdsMock.mockResolvedValue([makeProduct({ id: PRODUCT_ID, lifecycleStatus: "active" })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/bundles",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Good Bundle", componentProductIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
    expect(H.bundleInsertMock).toHaveBeenCalledOnce();
  });

  it("GET /v1/catalogue/bundles — 200 lists bundles", async () => {
    H.bundleListMock.mockResolvedValue({ rows: [makeBundle()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/bundles",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("GET /v1/catalogue/bundles — 403 for no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/bundles",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/catalogue/bundles/:id — 200 returns bundle with components", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    H.productFindByIdsMock.mockResolvedValue([makeProduct({ lifecycleStatus: "active" })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(BUNDLE_ID);
    expect(res.json().data.components).toBeDefined();
  });

  it("GET /v1/catalogue/bundles/:id — 404 for non-existent", async () => {
    H.bundleFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/bundles/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/catalogue/bundles/:id — 200 updates bundle", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated Bundle" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(2);
    expect(H.bundleUpdateMock).toHaveBeenCalledOnce();
  });

  it("PATCH /v1/catalogue/bundles/:id — 404 for non-existent", async () => {
    H.bundleFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/bundles/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/catalogue/bundles/:id — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/catalogue/bundles/:id — 422 when updating with inactive components", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    H.productFindByIdsMock.mockResolvedValue([makeProduct({ lifecycleStatus: "draft" })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { componentProductIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("DELETE /v1/catalogue/bundles/:id — 200 soft deletes", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("deleted");
    expect(H.bundleSoftDeleteMock).toHaveBeenCalledOnce();
  });

  it("DELETE /v1/catalogue/bundles/:id — 404 for non-existent", async () => {
    H.bundleFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/bundles/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/catalogue/bundles/:id — 403 for user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIMISTIC LOCKING — 409 on version conflict
// ═══════════════════════════════════════════════════════════════════════════════
describe("Optimistic locking (409 VERSION_CONFLICT)", () => {
  it("PATCH /v1/catalogue/products/:id — 409 when update affects no rows", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.productUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("PATCH /v1/catalogue/products/:id — passes body.version as expected version", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct({ version: 1 }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated", version: 7 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(8);
    expect(H.productUpdateMock).toHaveBeenCalledWith(expect.anything(), PRODUCT_ID, TENANT, expect.anything(), 7);
  });

  it("DELETE /v1/catalogue/products/:id — 409 when soft delete affects no rows", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.productSoftDeleteMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("PATCH /v1/catalogue/rates/:id — 409 when update affects no rows", async () => {
    H.rateFindByIdMock.mockResolvedValue(makeRate());
    H.rateUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/rates/${RATE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rateValueMinor: "9999", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("PATCH /v1/catalogue/bundles/:id — 409 when update affects no rows", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    H.bundleUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated Bundle", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("DELETE /v1/catalogue/bundles/:id — 409 when soft delete affects no rows", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    H.bundleSoftDeleteMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("DELETE /v1/catalogue/eligibility/rules/:id — 404 when delete affects no rows", async () => {
    H.eligFindByIdMock.mockResolvedValue(makeRule());
    H.eligDeleteRuleMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/eligibility/rules/${RULE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OUTBOX EVENTS — audit trail on every mutation
// ═══════════════════════════════════════════════════════════════════════════════
function enqueuedTypes(): string[] {
  return H.enqueueMock.mock.calls.map((call) => (call[1] as { eventType: string }).eventType);
}

describe("Outbox events on mutations", () => {
  it("POST /v1/catalogue/products — enqueues productCreated", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/products",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Savings Account", lifecycleStatus: "draft" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    expect(enqueuedTypes()).toEqual([EVENTS.productCreated]);
    const event = H.enqueueMock.mock.calls[0]![1] as {
      topic: string;
      tenantId: string;
      actorId: string;
      payload: Record<string, unknown>;
    };
    expect(event.topic).toBe(EVENTS.productCreated);
    expect(event.tenantId).toBe(TENANT);
    expect(event.actorId).toBe(ACTOR);
    expect(event.payload["productId"]).toBe(res.json().data.id);
  });

  it("PATCH /v1/catalogue/products/:id — enqueues productUpdated", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(enqueuedTypes()).toEqual([EVENTS.productUpdated]);
  });

  it("DELETE /v1/catalogue/products/:id — enqueues productDeleted", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(enqueuedTypes()).toEqual([EVENTS.productDeleted]);
  });

  it("POST /v1/catalogue/products/:id/availability — enqueues productUpdated", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/products/${PRODUCT_ID}/availability`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { circleId: "11111111-1111-4000-8000-111111111111", available: true },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(enqueuedTypes()).toEqual([EVENTS.productUpdated]);
  });

  it("POST /v1/catalogue/rates — enqueues rateCreated with bigint serialised as string", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/rates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { productId: PRODUCT_ID, effectiveFrom: "2025-01-01", rateValueMinor: "5000", source: "RBI Circular" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(enqueuedTypes()).toEqual([EVENTS.rateCreated]);
    const event = H.enqueueMock.mock.calls[0]![1] as { payload: Record<string, unknown> };
    expect(event.payload["rateValueMinor"]).toBe("5000");
  });

  it("PATCH /v1/catalogue/rates/:id — enqueues rateUpdated", async () => {
    H.rateFindByIdMock.mockResolvedValue(makeRate());
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/rates/${RATE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { rateValueMinor: "9999" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(enqueuedTypes()).toEqual([EVENTS.rateUpdated]);
  });

  it("POST /v1/catalogue/eligibility/rules — enqueues eligibilityRuleCreated", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/eligibility/rules",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { productId: PRODUCT_ID, ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(enqueuedTypes()).toEqual([EVENTS.eligibilityRuleCreated]);
  });

  it("DELETE /v1/catalogue/eligibility/rules/:id — enqueues eligibilityRuleDeleted", async () => {
    H.eligFindByIdMock.mockResolvedValue(makeRule());
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/eligibility/rules/${RULE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(enqueuedTypes()).toEqual([EVENTS.eligibilityRuleDeleted]);
  });

  it("POST /v1/catalogue/bundles — enqueues bundleCreated", async () => {
    H.productFindByIdsMock.mockResolvedValue([makeProduct({ id: PRODUCT_ID, lifecycleStatus: "active" })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/bundles",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Good Bundle", componentProductIds: [PRODUCT_ID] },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(enqueuedTypes()).toEqual([EVENTS.bundleCreated]);
  });

  it("PATCH /v1/catalogue/bundles/:id — enqueues bundleUpdated", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated Bundle" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(enqueuedTypes()).toEqual([EVENTS.bundleUpdated]);
  });

  it("DELETE /v1/catalogue/bundles/:id — enqueues bundleDeleted", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(enqueuedTypes()).toEqual([EVENTS.bundleDeleted]);
  });

  it("no event is enqueued when the write is rejected by optimistic locking", async () => {
    H.productFindByIdMock.mockResolvedValue(makeProduct());
    H.productUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });
});
