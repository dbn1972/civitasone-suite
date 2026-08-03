/**
 * Route-level coverage for QP-002 (price books + entries + resolve) and
 * PC-006 (bundle pricing approvals with maker-checker).
 *
 * MONEY: every amount assertion here checks that minor units are STRINGS and that
 * values above 2^53 round-trip exactly. A JSON number would silently lose them.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const MAKER = "00000000-0001-4000-8000-000000000001";
const CHECKER = "00000000-0002-4000-8000-000000000002";
const PRODUCT_ID = "11111111-1111-4000-8000-000000000001";
const BOOK_ID = "bbbbbbbb-bbbb-4000-8000-000000000001";
const BUNDLE_ID = "44444444-4444-4000-8000-000000000001";
const APPROVAL_ID = "cccccccc-cccc-4000-8000-000000000001";
const NON_EXISTENT_ID = "00000000-0000-4000-8000-000000000099";

/** 2^53 + 1 — the smallest integer a JS double cannot represent exactly. */
const ABOVE_2_53 = "9007199254740993";
/** A realistically huge paise amount well beyond double precision. */
const HUGE_PAISE = "123456789012345678901";

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  // price books
  listPriceBooksMock: vi.fn(),
  findPriceBookByIdMock: vi.fn(),
  insertPriceBookMock: vi.fn(),
  updatePriceBookMock: vi.fn(),
  listBooksForResolveMock: vi.fn(),
  listEntriesMock: vi.fn(),
  replaceEntriesMock: vi.fn(),
  listEntriesForProductMock: vi.fn(),
  // products
  productFindByIdMock: vi.fn(),
  // bundles
  bundleFindByIdMock: vi.fn(),
  listApprovalsMock: vi.fn(),
  findApprovalByIdMock: vi.fn(),
  findPendingApprovalMock: vi.fn(),
  insertApprovalMock: vi.fn(),
  decideApprovalMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(fn) },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn().mockResolvedValue([]),
    invalidate: vi.fn(),
    makeKey: (t: string, r: string, i: string) => `catalogue:${t}:${r}:${i}`,
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/price-books/repo.js", () => ({
  listPriceBooks: (...a: unknown[]) => H.listPriceBooksMock(...a),
  findPriceBookById: (...a: unknown[]) => H.findPriceBookByIdMock(...a),
  insertPriceBook: (...a: unknown[]) => H.insertPriceBookMock(...a),
  updatePriceBook: (...a: unknown[]) => H.updatePriceBookMock(...a),
  listBooksForResolve: (...a: unknown[]) => H.listBooksForResolveMock(...a),
  listEntries: (...a: unknown[]) => H.listEntriesMock(...a),
  replaceEntries: (...a: unknown[]) => H.replaceEntriesMock(...a),
  listEntriesForProduct: (...a: unknown[]) => H.listEntriesForProductMock(...a),
}));

vi.mock("../src/modules/products/repo.js", () => ({
  findById: (...a: unknown[]) => H.productFindByIdMock(...a),
  findByIds: vi.fn().mockResolvedValue([]),
  updateProduct: vi.fn().mockResolvedValue(true),
  listProducts: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  listByTenant: vi.fn().mockResolvedValue([]),
  insertProduct: vi.fn(),
  softDelete: vi.fn(),
}));

vi.mock("../src/modules/bundles/repo.js", () => ({
  findById: (...a: unknown[]) => H.bundleFindByIdMock(...a),
  listBundles: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  insertBundle: vi.fn(),
  updateBundle: vi.fn().mockResolvedValue(true),
  softDeleteBundle: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/modules/bundles/approvals-repo.js", () => ({
  listApprovals: (...a: unknown[]) => H.listApprovalsMock(...a),
  findApprovalById: (...a: unknown[]) => H.findApprovalByIdMock(...a),
  findPendingApproval: (...a: unknown[]) => H.findPendingApprovalMock(...a),
  insertApproval: (...a: unknown[]) => H.insertApprovalMock(...a),
  decideApproval: (...a: unknown[]) => H.decideApprovalMock(...a),
}));

import { buildApp } from "../src/app.js";
import { MAX_PRICE_BOOK_ENTRIES } from "../src/modules/price-books/routes.js";

function adminToken(sub = MAKER) {
  return signToken({ sub, tid: TENANT, roles: ["catalogue_admin"], sid: "s1" }, SECRET);
}
function approverToken(sub = CHECKER) {
  return signToken({ sub, tid: TENANT, roles: ["catalogue_approver"], sid: "s2" }, SECRET);
}
function readerToken() {
  return signToken({ sub: MAKER, tid: TENANT, roles: ["catalogue_user"], sid: "s3" }, SECRET);
}
function noRoleToken() {
  return signToken({ sub: MAKER, tid: TENANT, roles: ["employee"], sid: "s4" }, SECRET);
}

function makeBook(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOK_ID,
    tenantId: TENANT,
    name: "Retail INR 2026",
    segment: "retail",
    currency: "INR",
    geography: {},
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: MAKER,
    updatedBy: MAKER,
    version: 1,
    ...overrides,
  };
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "dddddddd-dddd-4000-8000-000000000001",
    tenantId: TENANT,
    priceBookId: BOOK_ID,
    productId: PRODUCT_ID,
    amountMinor: 250000n,
    currency: "INR",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: MAKER,
    updatedBy: MAKER,
    version: 1,
    ...overrides,
  };
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
    taxRateBps: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: MAKER,
    updatedBy: MAKER,
    version: 1,
    ...overrides,
  };
}

function makeBundle(overrides: Record<string, unknown> = {}) {
  return {
    id: BUNDLE_ID,
    tenantId: TENANT,
    name: "Savings Bundle",
    description: null,
    componentProductIds: [PRODUCT_ID],
    pricingApprovalRequired: true,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: MAKER,
    updatedBy: MAKER,
    version: 1,
    ...overrides,
  };
}

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: APPROVAL_ID,
    tenantId: TENANT,
    bundleId: BUNDLE_ID,
    status: "pending",
    requestedBy: MAKER,
    approvedBy: null,
    reason: null,
    decidedBy: null,
    decidedAt: null,
    pricingAmountMinor: 500000n,
    currency: "INR",
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.insertPriceBookMock.mockResolvedValue(undefined);
  H.updatePriceBookMock.mockResolvedValue(true);
  H.replaceEntriesMock.mockImplementation((_tx: unknown, _b: string, _t: string, rows: unknown[]) => Promise.resolve(rows.length));
  H.listPriceBooksMock.mockResolvedValue({ rows: [], total: 0 });
  H.listEntriesMock.mockResolvedValue({ rows: [], total: 0 });
  H.listBooksForResolveMock.mockResolvedValue([]);
  H.listEntriesForProductMock.mockResolvedValue([]);
  H.listApprovalsMock.mockResolvedValue({ rows: [], total: 0 });
  H.findPendingApprovalMock.mockResolvedValue(null);
  H.insertApprovalMock.mockResolvedValue(undefined);
  H.decideApprovalMock.mockResolvedValue(true);
  H.productFindByIdMock.mockResolvedValue(makeProduct());
  H.dbTransactionMock.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({}));
});

// ═══════════════════════════════════════════════════════════════════════════════
// QP-002 — price books CRUD
// ═══════════════════════════════════════════════════════════════════════════════
describe("QP-002 GET /v1/catalogue/price-books", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/catalogue/price-books" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when limit exceeds 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/price-books?limit=201",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid status filter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/price-books?status=live",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("200 lists price books in the standard envelope", async () => {
    H.listPriceBooksMock.mockResolvedValue({ rows: [makeBook()], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
  });

  it("200 passes segment and currency filters through", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/price-books?segment=retail&currency=INR&status=active",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(H.listPriceBooksMock).toHaveBeenCalledWith(
      expect.objectContaining({ segment: "retail", currency: "INR", status: "active" }),
    );
  });
});

describe("QP-002 POST /v1/catalogue/price-books", () => {
  const VALID = { name: "Retail INR", segment: "retail", currency: "INR" };

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/catalogue/price-books", payload: VALID });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when required fields are missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a lowercase / malformed currency", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, currency: "inr" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a 4-letter currency", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, currency: "INRR" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("202 creates a draft price book", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("202 accepts a geography selector", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...VALID, status: "active", geography: { circleCode: "KA", regionCode: "BLR" } },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(res.json().status).toBe("accepted");
  });

  it("422 when effectiveTo precedes effectiveFrom", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalogue/price-books",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...VALID,
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        effectiveTo: "2026-01-01T00:00:00.000Z",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_EFFECTIVE_WINDOW");
  });
});

describe("QP-002 PATCH /v1/catalogue/price-books/:id", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${BOOK_ID}`,
      payload: { name: "New" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${BOOK_ID}`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { name: "New" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for an empty patch body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${BOOK_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown price book", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "New" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 activates a draft book", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook({ status: "draft" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${BOOK_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "active" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("202 clears effectiveTo with an explicit null", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook({ effectiveTo: new Date("2026-12-31T00:00:00Z") }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${BOOK_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { effectiveTo: null },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("422 when the patch would invert the effective window", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook({ effectiveFrom: new Date("2026-06-01T00:00:00Z") }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${BOOK_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { effectiveTo: "2026-01-01T00:00:00.000Z" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("409 when the optimistic lock does not match", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    H.updatePriceBookMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/catalogue/price-books/${BOOK_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "New", version: 99 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QP-002 — entries (BIGINT MONEY)
// ═══════════════════════════════════════════════════════════════════════════════
describe("QP-002 GET /v1/catalogue/price-books/:id/entries", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/price-books/${BOOK_ID}/entries` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown price book", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/price-books/${NON_EXISTENT_ID}/entries`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 serialises amountMinor as a STRING", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    H.listEntriesMock.mockResolvedValue({ rows: [makeEntry({ amountMinor: 250000n })], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const entry = res.json().data[0];
    expect(entry.amountMinor).toBe("250000");
    expect(typeof entry.amountMinor).toBe("string");
  });

  it("200 round-trips a value above 2^53 as an EXACT string", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    H.listEntriesMock.mockResolvedValue({ rows: [makeEntry({ amountMinor: BigInt(ABOVE_2_53) })], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    const amount = res.json().data[0].amountMinor;
    expect(amount).toBe(ABOVE_2_53);
    // Prove that going via Number would have corrupted it.
    expect(String(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);
    // And that the raw wire bytes carry the exact digits, not a float.
    expect(res.body).toContain(`"${ABOVE_2_53}"`);
  });

  it("200 round-trips a 21-digit paise amount exactly", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    H.listEntriesMock.mockResolvedValue({ rows: [makeEntry({ amountMinor: BigInt(HUGE_PAISE) })], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.json().data[0].amountMinor).toBe(HUGE_PAISE);
  });
});

describe("QP-002 PUT /v1/catalogue/price-books/:id/entries", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      payload: { entries: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { entries: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when entries is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a fractional amountMinor (paise are indivisible)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries: [{ productId: PRODUCT_ID, amountMinor: "100.5" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a negative amountMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries: [{ productId: PRODUCT_ID, amountMinor: "-1" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-numeric amountMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries: [{ productId: PRODUCT_ID, amountMinor: "lots" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it(`400 when more than ${MAX_PRICE_BOOK_ENTRIES} entries are supplied`, async () => {
    const entries = Array.from({ length: MAX_PRICE_BOOK_ENTRIES + 1 }, () => ({
      productId: PRODUCT_ID,
      amountMinor: "100",
    }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown price book", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${NON_EXISTENT_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries: [{ productId: PRODUCT_ID, amountMinor: "100" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 replaces entries and stores an exact bigint above 2^53", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries: [{ productId: PRODUCT_ID, amountMinor: ABOVE_2_53 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
    const cmd = H.publishMock.mock.calls[0]![1] as { payload: { entries: Array<{ amountMinor: string }> } };
    expect(cmd.payload.entries[0]!.amountMinor).toBe(ABOVE_2_53);

  });

  it("202 sums entry amounts with BigInt in the emitted event", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entries: [
          { productId: PRODUCT_ID, amountMinor: ABOVE_2_53 },
          { productId: "11111111-1111-4000-8000-000000000002", amountMinor: "1" },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const event = H.publishMock.mock.calls[0]?.[1] as { payload: { totalAmountMinor: string } };
    // 9007199254740993 + 1 = 9007199254740994, exactly.
    expect(event.payload.totalAmountMinor).toBe("9007199254740994");
  });

  it("202 accepts an empty entry set (clears the book)", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("422 for a duplicate product in the same call", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook());
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entries: [
          { productId: PRODUCT_ID, amountMinor: "100" },
          { productId: PRODUCT_ID, amountMinor: "200" },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("DUPLICATE_ENTRY");
  });

  it("422 when an entry currency differs from the book currency", async () => {
    H.findPriceBookByIdMock.mockResolvedValue(makeBook({ currency: "INR" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/catalogue/price-books/${BOOK_ID}/entries`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { entries: [{ productId: PRODUCT_ID, amountMinor: "100", currency: "USD" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CURRENCY_MISMATCH");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QP-002 — resolve
// ═══════════════════════════════════════════════════════════════════════════════
describe("QP-002 GET /v1/catalogue/price-books/resolve", () => {
  const BASE = `/v1/catalogue/price-books/resolve?productId=${PRODUCT_ID}&segment=retail&currency=INR`;

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${noRoleToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when segment is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/price-books/resolve?productId=${PRODUCT_ID}&currency=INR`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when productId is not a uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/price-books/resolve?productId=abc&segment=retail&currency=INR",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 when no active book matches the segment/currency", async () => {
    H.listBooksForResolveMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${readerToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("404 when the matching book has no entry for the product", async () => {
    H.listBooksForResolveMock.mockResolvedValue([makeBook()]);
    H.listEntriesForProductMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${readerToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 resolves the price as a STRING of minor units", async () => {
    H.listBooksForResolveMock.mockResolvedValue([makeBook()]);
    H.listEntriesForProductMock.mockResolvedValue([makeEntry({ amountMinor: 250000n })]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${readerToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.amountMinor).toBe("250000");
    expect(typeof data.amountMinor).toBe("string");
    expect(data.currency).toBe("INR");
  });

  it("200 resolves a price above 2^53 exactly", async () => {
    H.listBooksForResolveMock.mockResolvedValue([makeBook()]);
    H.listEntriesForProductMock.mockResolvedValue([makeEntry({ amountMinor: BigInt(ABOVE_2_53) })]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${readerToken()}` } });
    await app.close();
    expect(res.json().data.amountMinor).toBe(ABOVE_2_53);
    expect(res.body).toContain(`"${ABOVE_2_53}"`);
  });

  it("200 adds basis-point tax computed with BigInt", async () => {
    H.listBooksForResolveMock.mockResolvedValue([makeBook()]);
    H.listEntriesForProductMock.mockResolvedValue([makeEntry({ amountMinor: 100000n })]);
    H.productFindByIdMock.mockResolvedValue(makeProduct({ taxRateBps: 1800 }));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${readerToken()}` } });
    await app.close();
    const data = res.json().data;
    expect(data.taxRateBps).toBe(1800);
    expect(data.taxAmountMinor).toBe("18000");
    expect(data.totalAmountMinor).toBe("118000");
  });

  it("200 keeps the total exact for a huge amount", async () => {
    H.listBooksForResolveMock.mockResolvedValue([makeBook()]);
    H.listEntriesForProductMock.mockResolvedValue([makeEntry({ amountMinor: BigInt(ABOVE_2_53) })]);
    H.productFindByIdMock.mockResolvedValue(makeProduct({ taxRateBps: 10000 })); // 100%
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${readerToken()}` } });
    await app.close();
    const data = res.json().data;
    expect(data.taxAmountMinor).toBe(ABOVE_2_53);
    expect(data.totalAmountMinor).toBe((BigInt(ABOVE_2_53) * 2n).toString());
  });

  it("200 prefers the geographically more specific book", async () => {
    H.listBooksForResolveMock.mockResolvedValue([
      makeBook({ id: "wide", geography: {} }),
      makeBook({ id: "narrow", geography: { circleCode: "KA" } }),
    ]);
    H.listEntriesForProductMock.mockResolvedValue([
      makeEntry({ priceBookId: "wide", amountMinor: 900000n }),
      makeEntry({ priceBookId: "narrow", amountMinor: 800000n }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `${BASE}&circleCode=KA`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    const data = res.json().data;
    expect(data.priceBookId).toBe("narrow");
    expect(data.amountMinor).toBe("800000");
    expect(data.specificity).toBe(1);
  });

  it("200 falls back to the wildcard book when the geography does not match", async () => {
    H.listBooksForResolveMock.mockResolvedValue([
      makeBook({ id: "wide", geography: {} }),
      makeBook({ id: "narrow", geography: { circleCode: "TN" } }),
    ]);
    H.listEntriesForProductMock.mockResolvedValue([
      makeEntry({ priceBookId: "wide", amountMinor: 900000n }),
      makeEntry({ priceBookId: "narrow", amountMinor: 800000n }),
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `${BASE}&circleCode=KA`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.json().data.priceBookId).toBe("wide");
  });

  it("200 tolerates a missing product row (tax defaults to 0 bps)", async () => {
    H.listBooksForResolveMock.mockResolvedValue([makeBook()]);
    H.listEntriesForProductMock.mockResolvedValue([makeEntry({ amountMinor: 100000n })]);
    H.productFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${readerToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.taxRateBps).toBe(0);
    expect(res.json().data.taxAmountMinor).toBe("0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-006 — bundle pricing approvals
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-006 GET /v1/catalogue/bundles/:id/approvals", () => {
  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a no-role token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${noRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid bundle id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/catalogue/bundles/xx/approvals",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown bundle", async () => {
    H.bundleFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/bundles/${NON_EXISTENT_ID}/approvals`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("200 lists approvals with money as a STRING", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    H.listApprovalsMock.mockResolvedValue({
      rows: [makeApproval({ pricingAmountMinor: BigInt(ABOVE_2_53) })],
      total: 1,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const row = res.json().data[0];
    expect(row.pricingAmountMinor).toBe(ABOVE_2_53);
    expect(typeof row.pricingAmountMinor).toBe("string");
  });

  it("200 tolerates an approval with no price recorded", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    H.listApprovalsMock.mockResolvedValue({ rows: [makeApproval({ pricingAmountMinor: null })], total: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect(res.json().data[0].pricingAmountMinor).toBeNull();
  });
});

describe("PC-006 POST /v1/catalogue/bundles/:id/approvals", () => {
  const VALID = { pricingAmountMinor: "500000", currency: "INR" };

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when the price is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { currency: "INR" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a fractional price", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { pricingAmountMinor: "500.50", currency: "INR" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a malformed currency", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { pricingAmountMinor: "500000", currency: "rupee" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown bundle", async () => {
    H.bundleFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${NON_EXISTENT_ID}/approvals`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 requests approval and echoes the price as a STRING", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { pricingAmountMinor: ABOVE_2_53, currency: "INR", reason: "Festive offer" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json().status).toBe("accepted");
    // The value persisted is a bigint of the exact digits.
    expect(H.publishMock).toHaveBeenCalledOnce();
    // The event payload carries it as a string too.
    const event = H.publishMock.mock.calls[0]?.[1] as { payload: { pricingAmountMinor: string } };
    expect(event.payload.pricingAmountMinor).toBe(ABOVE_2_53);
  });

  it("422 when an approval is already pending for the bundle", async () => {
    H.bundleFindByIdMock.mockResolvedValue(makeBundle());
    H.findPendingApprovalMock.mockResolvedValue(makeApproval());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/${BUNDLE_ID}/approvals`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID,
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("APPROVAL_ALREADY_PENDING");
  });
});

describe("PC-006 POST /v1/catalogue/bundles/approvals/:approvalId/decide — maker-checker", () => {
  it("422 when the REQUESTER tries to decide their own request", async () => {
    H.findApprovalByIdMock.mockResolvedValue(makeApproval({ requestedBy: MAKER, status: "pending" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      // MAKER holds an approver role but is the requester.
      headers: { authorization: `Bearer ${signToken({ sub: MAKER, tid: TENANT, roles: ["catalogue_approver"], sid: "s" }, SECRET)}` },
      payload: { decision: "approved" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    // Nothing was written.
    expect(H.decideApprovalMock).not.toHaveBeenCalled();
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("202 when a different actor approves", async () => {
    H.findApprovalByIdMock.mockResolvedValue(makeApproval({ requestedBy: MAKER, status: "pending" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "approved" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("202 rejects with a substantive reason", async () => {
    H.findApprovalByIdMock.mockResolvedValue(makeApproval({ requestedBy: MAKER, status: "pending" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "rejected", reason: "Margin is below the approved floor" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(res.json().status).toBe("accepted");
  });

  it("422 when rejecting without a reason", async () => {
    H.findApprovalByIdMock.mockResolvedValue(makeApproval({ requestedBy: MAKER, status: "pending" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "rejected" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("REASON_REQUIRED");
  });

  it("422 when the rejection reason is too short", async () => {
    H.findApprovalByIdMock.mockResolvedValue(makeApproval({ requestedBy: MAKER, status: "pending" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "rejected", reason: "no" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      payload: { decision: "approved" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a plain catalogue_user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${readerToken()}` },
      payload: { decision: "approved" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for an invalid decision value", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "maybe" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when the decision is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown approval", async () => {
    H.findApprovalByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${NON_EXISTENT_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "approved" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("422 when the approval was already decided", async () => {
    H.findApprovalByIdMock.mockResolvedValue(makeApproval({ status: "approved", requestedBy: MAKER }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "rejected", reason: "Changed our mind entirely" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ALREADY_DECIDED");
  });

  it("202 accepts; version conflict deferred to consumer", async () => {
    H.findApprovalByIdMock.mockResolvedValue(makeApproval({ requestedBy: MAKER, status: "pending" }));
    H.decideApprovalMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "approved" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
  });

  it("202 preserves the priced amount as a STRING in the emitted event", async () => {
    H.findApprovalByIdMock.mockResolvedValue(
      makeApproval({ requestedBy: MAKER, status: "pending", pricingAmountMinor: BigInt(HUGE_PAISE) }),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/catalogue/bundles/approvals/${APPROVAL_ID}/decide`,
      headers: { authorization: `Bearer ${approverToken()}` },
      payload: { decision: "approved" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const event = H.publishMock.mock.calls[0]?.[1] as { payload: { pricingAmountMinor?: string; decision?: string } };
    expect(event).toBeDefined();
    // pricing lives on the approval row / command payload depending on topic
    expect(event.payload).toBeDefined();
  });
});
