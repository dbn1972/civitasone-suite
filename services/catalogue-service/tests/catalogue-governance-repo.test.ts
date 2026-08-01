/**
 * Repo-level tests for the Sprint 2 repos (PC-001..PC-006, PC-008, QP-001, QP-002).
 * Drizzle query builders are exercised against a fake transaction — no database
 * connection. Focus: the optimistic-locking contract (writes return false when no
 * row matched the expected version), read helpers, and the "current state from an
 * ordered history" derivation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const PRODUCT_ID = "11111111-1111-4000-8000-000000000001";
const OTHER_PRODUCT_ID = "11111111-1111-4000-8000-000000000002";
const VERSION_ID = "55555555-5555-4000-8000-000000000001";
const RULE_ID = "88888888-8888-4000-8000-000000000001";
const RATE_ID = "22222222-2222-4000-8000-000000000001";
const BUNDLE_ID = "44444444-4444-4000-8000-000000000001";
const APPROVAL_ID = "cccccccc-cccc-4000-8000-000000000001";
const BOOK_ID = "bbbbbbbb-bbbb-4000-8000-000000000001";
const ACTOR = "00000000-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({ scopedReadMock: vi.fn() }));

vi.mock("../src/shared/db.js", () => ({
  db: {},
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

import * as govRepo from "../src/modules/products/governance-repo.js";
import * as classificationRepo from "../src/modules/products/classification-repo.js";
import * as externalRefRepo from "../src/modules/rates/external-ref-repo.js";
import * as approvalRepo from "../src/modules/bundles/approvals-repo.js";
import * as priceBookRepo from "../src/modules/price-books/repo.js";
import type { ScopedTx } from "../src/shared/db.js";

/** Chainable Drizzle-query stub that resolves to `result` when awaited. */
function chain(result: unknown): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "offset", "orderBy", "set", "values", "returning"]) {
    node[method] = () => node;
  }
  node["then"] = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return node;
}

interface FakeTxOptions {
  rows?: unknown[];
  count?: number;
  returning?: unknown[];
}

function fakeTx(opts: FakeTxOptions = {}): ScopedTx {
  const { rows = [], count = rows.length, returning = [] } = opts;
  const tx = {
    select: (projection?: Record<string, unknown>) =>
      projection && "count" in projection ? chain([{ count }]) : chain(rows),
    selectDistinct: () => chain(rows),
    insert: () => chain(undefined),
    update: () => chain(returning),
    delete: () => chain(returning),
  };
  return tx as unknown as ScopedTx;
}

function withTx(opts: FakeTxOptions = {}): void {
  H.scopedReadMock.mockImplementation((fn: (tx: ScopedTx) => Promise<unknown>) => fn(fakeTx(opts)));
}

beforeEach(() => {
  vi.clearAllMocks();
  withTx();
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-001 — product versions
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-001 governance-repo product versions", () => {
  it("listVersions returns rows plus the total", async () => {
    withTx({ rows: [{ id: VERSION_ID }], count: 4 });
    const res = await govRepo.listVersions(PRODUCT_ID, TENANT, 10, 0);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBe(4);
  });

  it("listVersions reports 0 when the count projection is empty", async () => {
    H.scopedReadMock.mockImplementation((fn: (tx: ScopedTx) => Promise<unknown>) => {
      const tx = {
        select: (projection?: Record<string, unknown>) =>
          projection && "count" in projection ? chain([]) : chain([]),
      } as unknown as ScopedTx;
      return fn(tx);
    });
    const res = await govRepo.listVersions(PRODUCT_ID, TENANT, 10, 0);
    expect(res.total).toBe(0);
  });

  it("findVersionById returns the row or null", async () => {
    withTx({ rows: [{ id: VERSION_ID }] });
    await expect(govRepo.findVersionById(VERSION_ID, TENANT)).resolves.toEqual({ id: VERSION_ID });
    withTx({ rows: [] });
    await expect(govRepo.findVersionById(VERSION_ID, TENANT)).resolves.toBeNull();
  });

  it("listVersionNumbers projects just the numbers", async () => {
    withTx({ rows: [{ n: 1 }, { n: 2 }, { n: 5 }] });
    await expect(govRepo.listVersionNumbers(PRODUCT_ID, TENANT)).resolves.toEqual([1, 2, 5]);
  });

  it("insertVersion writes through the supplied transaction", async () => {
    const tx = fakeTx();
    const spy = vi.spyOn(tx, "insert");
    await govRepo.insertVersion(tx, {
      id: VERSION_ID,
      tenantId: TENANT,
      productId: PRODUCT_ID,
      versionNumber: 1,
      createdBy: ACTOR,
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("updateVersionStatus returns true only when a row came back", async () => {
    await expect(
      govRepo.updateVersionStatus(fakeTx({ returning: [{ id: VERSION_ID }] }), VERSION_ID, TENANT, { status: "approved" }, 1),
    ).resolves.toBe(true);
    await expect(
      govRepo.updateVersionStatus(fakeTx({ returning: [] }), VERSION_ID, TENANT, { status: "approved" }, 99),
    ).resolves.toBe(false);
  });

  it("findLatestApprovedVersion returns the newest approved row or null", async () => {
    withTx({ rows: [{ id: VERSION_ID, versionNumber: 3 }] });
    await expect(govRepo.findLatestApprovedVersion(PRODUCT_ID, TENANT)).resolves.toMatchObject({ versionNumber: 3 });
    withTx({ rows: [] });
    await expect(govRepo.findLatestApprovedVersion(PRODUCT_ID, TENANT)).resolves.toBeNull();
  });

  it("productIdsWithApprovedVersion projects distinct product ids", async () => {
    withTx({ rows: [{ productId: PRODUCT_ID }, { productId: OTHER_PRODUCT_ID }] });
    await expect(govRepo.productIdsWithApprovedVersion(TENANT)).resolves.toEqual([PRODUCT_ID, OTHER_PRODUCT_ID]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-002 — lifecycle
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-002 governance-repo lifecycle", () => {
  it("listLifecycleHistory returns the ordered history", async () => {
    withTx({ rows: [{ state: "sunset" }, { state: "active" }] });
    await expect(govRepo.listLifecycleHistory(PRODUCT_ID, TENANT)).resolves.toHaveLength(2);
  });

  it("findCurrentLifecycle returns the newest row or null", async () => {
    withTx({ rows: [{ state: "sunset" }] });
    await expect(govRepo.findCurrentLifecycle(PRODUCT_ID, TENANT)).resolves.toEqual({ state: "sunset" });
    withTx({ rows: [] });
    await expect(govRepo.findCurrentLifecycle(PRODUCT_ID, TENANT)).resolves.toBeNull();
  });

  it("insertLifecycle appends a history row", async () => {
    const tx = fakeTx();
    const spy = vi.spyOn(tx, "insert");
    await govRepo.insertLifecycle(tx, {
      id: "66666666-6666-4000-8000-000000000001",
      tenantId: TENANT,
      productId: PRODUCT_ID,
      state: "sunset",
      createdBy: ACTOR,
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("activeLifecycleProductIds keeps only products whose NEWEST row is active", async () => {
    // Rows arrive newest-first within each product id (ORDER BY in the query).
    withTx({
      rows: [
        { productId: PRODUCT_ID, state: "active" },        // newest for A -> active
        { productId: PRODUCT_ID, state: "sunset" },        // older, ignored
        { productId: OTHER_PRODUCT_ID, state: "retired" }, // newest for B -> not active
        { productId: OTHER_PRODUCT_ID, state: "active" },  // older, ignored
      ],
    });
    await expect(govRepo.activeLifecycleProductIds(TENANT)).resolves.toEqual([PRODUCT_ID]);
  });

  it("activeLifecycleProductIds returns an empty list when nothing is tracked", async () => {
    withTx({ rows: [] });
    await expect(govRepo.activeLifecycleProductIds(TENANT)).resolves.toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-003 — regulatory metadata
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-003 governance-repo regulatory metadata", () => {
  it("findRegulatory returns the row or null", async () => {
    withTx({ rows: [{ id: "reg-1" }] });
    await expect(govRepo.findRegulatory(PRODUCT_ID, TENANT)).resolves.toEqual({ id: "reg-1" });
    withTx({ rows: [] });
    await expect(govRepo.findRegulatory(PRODUCT_ID, TENANT)).resolves.toBeNull();
  });

  it("insertRegulatory writes through the transaction", async () => {
    const tx = fakeTx();
    const spy = vi.spyOn(tx, "insert");
    await govRepo.insertRegulatory(tx, {
      id: "reg-1",
      tenantId: TENANT,
      productId: PRODUCT_ID,
      regulation: "RBI MD 2016",
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("updateRegulatory reports the optimistic-lock outcome", async () => {
    await expect(
      govRepo.updateRegulatory(fakeTx({ returning: [{ id: "reg-1" }] }), PRODUCT_ID, TENANT, { notes: "x" }, 1),
    ).resolves.toBe(true);
    await expect(
      govRepo.updateRegulatory(fakeTx({ returning: [] }), PRODUCT_ID, TENANT, { notes: "x" }, 99),
    ).resolves.toBe(false);
  });

  it("listExpiringRegulatory returns rows plus the total", async () => {
    withTx({ rows: [{ id: "reg-1" }], count: 2 });
    const res = await govRepo.listExpiringRegulatory(TENANT, new Date("2026-12-31T00:00:00Z"), 10, 0);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-004 — availability v2
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-004 governance-repo availability", () => {
  it("listAvailabilityV2 reads the product's rows", async () => {
    withTx({ rows: [{ circleCode: "KA" }, { circleCode: "TN" }] });
    await expect(govRepo.listAvailabilityV2(PRODUCT_ID, TENANT)).resolves.toHaveLength(2);
  });

  it("replaceAvailabilityV2 deletes then inserts and returns the row count", async () => {
    const tx = fakeTx();
    const deleteSpy = vi.spyOn(tx, "delete");
    const insertSpy = vi.spyOn(tx, "insert");
    const written = await govRepo.replaceAvailabilityV2(tx, PRODUCT_ID, TENANT, [
      { id: "a1", tenantId: TENANT, productId: PRODUCT_ID, circleCode: "KA" },
      { id: "a2", tenantId: TENANT, productId: PRODUCT_ID, circleCode: "TN" },
    ]);
    expect(written).toBe(2);
    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(insertSpy).toHaveBeenCalledOnce();
  });

  it("replaceAvailabilityV2 deletes but skips the insert for an empty set", async () => {
    const tx = fakeTx();
    const deleteSpy = vi.spyOn(tx, "delete");
    const insertSpy = vi.spyOn(tx, "insert");
    await expect(govRepo.replaceAvailabilityV2(tx, PRODUCT_ID, TENANT, [])).resolves.toBe(0);
    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-008 — cross-sell
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-008 governance-repo cross-sell", () => {
  it("listCrossSell reads with and without the enabled filter", async () => {
    withTx({ rows: [{ id: RULE_ID }] });
    await expect(govRepo.listCrossSell(PRODUCT_ID, TENANT, false)).resolves.toHaveLength(1);
    await expect(govRepo.listCrossSell(PRODUCT_ID, TENANT, true)).resolves.toHaveLength(1);
  });

  it("findCrossSellById returns the row or null", async () => {
    withTx({ rows: [{ id: RULE_ID }] });
    await expect(govRepo.findCrossSellById(RULE_ID, TENANT)).resolves.toEqual({ id: RULE_ID });
    withTx({ rows: [] });
    await expect(govRepo.findCrossSellById(RULE_ID, TENANT)).resolves.toBeNull();
  });

  it("insertCrossSell writes through the transaction", async () => {
    const tx = fakeTx();
    const spy = vi.spyOn(tx, "insert");
    await govRepo.insertCrossSell(tx, {
      id: RULE_ID,
      tenantId: TENANT,
      sourceProductId: PRODUCT_ID,
      targetProductId: OTHER_PRODUCT_ID,
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("deleteCrossSell reports whether a row was removed", async () => {
    await expect(govRepo.deleteCrossSell(fakeTx({ returning: [{ id: RULE_ID }] }), RULE_ID, TENANT)).resolves.toBe(true);
    await expect(govRepo.deleteCrossSell(fakeTx({ returning: [] }), RULE_ID, TENANT)).resolves.toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QP-001 — classification lookup
// ═══════════════════════════════════════════════════════════════════════════════
describe("QP-001 classification-repo", () => {
  it("findByProductCode returns the row or null", async () => {
    withTx({ rows: [{ id: PRODUCT_ID, productCode: "SAV-001" }] });
    await expect(classificationRepo.findByProductCode("SAV-001", TENANT)).resolves.toMatchObject({ productCode: "SAV-001" });
    withTx({ rows: [] });
    await expect(classificationRepo.findByProductCode("NOPE", TENANT)).resolves.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-005 — rate external refs
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-005 external-ref-repo", () => {
  it("listExternalRefs returns rows plus the total", async () => {
    withTx({ rows: [{ id: RATE_ID }], count: 1 });
    const res = await externalRefRepo.listExternalRefs({ tenantId: TENANT, limit: 10, offset: 0 });
    expect(res.total).toBe(1);
  });

  it("listExternalRefs applies the optional filters", async () => {
    withTx({ rows: [], count: 0 });
    const res = await externalRefRepo.listExternalRefs({
      tenantId: TENANT,
      limit: 10,
      offset: 0,
      sourceSystem: "CBS",
      productId: PRODUCT_ID,
    });
    expect(res.total).toBe(0);
  });

  it("setExternalRef reports the optimistic-lock outcome", async () => {
    const ref = { sourceSystem: "CBS", externalId: "RT-1", syncedAt: new Date(), updatedBy: ACTOR };
    await expect(
      externalRefRepo.setExternalRef(fakeTx({ returning: [{ id: RATE_ID }] }), RATE_ID, TENANT, ref, 1),
    ).resolves.toBe(true);
    await expect(
      externalRefRepo.setExternalRef(fakeTx({ returning: [] }), RATE_ID, TENANT, ref, 99),
    ).resolves.toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-006 — bundle approvals
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-006 approvals-repo", () => {
  it("listApprovals returns rows plus the total", async () => {
    withTx({ rows: [{ id: APPROVAL_ID }], count: 3 });
    const res = await approvalRepo.listApprovals(BUNDLE_ID, TENANT, 10, 0);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBe(3);
  });

  it("findApprovalById returns the row or null", async () => {
    withTx({ rows: [{ id: APPROVAL_ID }] });
    await expect(approvalRepo.findApprovalById(APPROVAL_ID, TENANT)).resolves.toEqual({ id: APPROVAL_ID });
    withTx({ rows: [] });
    await expect(approvalRepo.findApprovalById(APPROVAL_ID, TENANT)).resolves.toBeNull();
  });

  it("findPendingApproval returns the open request or null", async () => {
    withTx({ rows: [{ id: APPROVAL_ID, status: "pending" }] });
    await expect(approvalRepo.findPendingApproval(BUNDLE_ID, TENANT)).resolves.toMatchObject({ status: "pending" });
    withTx({ rows: [] });
    await expect(approvalRepo.findPendingApproval(BUNDLE_ID, TENANT)).resolves.toBeNull();
  });

  it("insertApproval writes a bigint price through the transaction", async () => {
    const tx = fakeTx();
    const spy = vi.spyOn(tx, "insert");
    await approvalRepo.insertApproval(tx, {
      id: APPROVAL_ID,
      tenantId: TENANT,
      bundleId: BUNDLE_ID,
      requestedBy: ACTOR,
      pricingAmountMinor: 9007199254740993n,
      currency: "INR",
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("decideApproval reports the optimistic-lock outcome", async () => {
    await expect(
      approvalRepo.decideApproval(fakeTx({ returning: [{ id: APPROVAL_ID }] }), APPROVAL_ID, TENANT, { status: "approved" }, 1),
    ).resolves.toBe(true);
    await expect(
      approvalRepo.decideApproval(fakeTx({ returning: [] }), APPROVAL_ID, TENANT, { status: "approved" }, 99),
    ).resolves.toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QP-002 — price books
// ═══════════════════════════════════════════════════════════════════════════════
describe("QP-002 price-books repo", () => {
  it("listPriceBooks returns rows plus the total", async () => {
    withTx({ rows: [{ id: BOOK_ID }], count: 1 });
    const res = await priceBookRepo.listPriceBooks({ tenantId: TENANT, limit: 10, offset: 0 });
    expect(res.total).toBe(1);
  });

  it("listPriceBooks applies status, segment and currency filters", async () => {
    withTx({ rows: [], count: 0 });
    const res = await priceBookRepo.listPriceBooks({
      tenantId: TENANT,
      limit: 10,
      offset: 0,
      status: "active",
      segment: "retail",
      currency: "INR",
    });
    expect(res.total).toBe(0);
  });

  it("findPriceBookById returns the row or null", async () => {
    withTx({ rows: [{ id: BOOK_ID }] });
    await expect(priceBookRepo.findPriceBookById(BOOK_ID, TENANT)).resolves.toEqual({ id: BOOK_ID });
    withTx({ rows: [] });
    await expect(priceBookRepo.findPriceBookById(BOOK_ID, TENANT)).resolves.toBeNull();
  });

  it("insertPriceBook writes through the transaction", async () => {
    const tx = fakeTx();
    const spy = vi.spyOn(tx, "insert");
    await priceBookRepo.insertPriceBook(tx, {
      id: BOOK_ID,
      tenantId: TENANT,
      name: "Retail INR",
      segment: "retail",
      currency: "INR",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("updatePriceBook reports the optimistic-lock outcome", async () => {
    await expect(
      priceBookRepo.updatePriceBook(fakeTx({ returning: [{ id: BOOK_ID }] }), BOOK_ID, TENANT, { name: "x" }, 1),
    ).resolves.toBe(true);
    await expect(
      priceBookRepo.updatePriceBook(fakeTx({ returning: [] }), BOOK_ID, TENANT, { name: "x" }, 99),
    ).resolves.toBe(false);
  });

  it("listBooksForResolve reads only the matching active books", async () => {
    withTx({ rows: [{ id: BOOK_ID, status: "active" }] });
    await expect(priceBookRepo.listBooksForResolve(TENANT, "retail", "INR")).resolves.toHaveLength(1);
  });

  it("listEntries returns rows plus the total", async () => {
    withTx({ rows: [{ id: "e1" }], count: 1 });
    const res = await priceBookRepo.listEntries(BOOK_ID, TENANT, 10, 0);
    expect(res.total).toBe(1);
  });

  it("replaceEntries deletes then inserts and returns the row count", async () => {
    const tx = fakeTx();
    const deleteSpy = vi.spyOn(tx, "delete");
    const insertSpy = vi.spyOn(tx, "insert");
    const written = await priceBookRepo.replaceEntries(tx, BOOK_ID, TENANT, [
      {
        id: "e1",
        tenantId: TENANT,
        priceBookId: BOOK_ID,
        productId: PRODUCT_ID,
        amountMinor: 9007199254740993n,
        currency: "INR",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
    ]);
    expect(written).toBe(1);
    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(insertSpy).toHaveBeenCalledOnce();
  });

  it("replaceEntries deletes but skips the insert for an empty set", async () => {
    const tx = fakeTx();
    const insertSpy = vi.spyOn(tx, "insert");
    await expect(priceBookRepo.replaceEntries(tx, BOOK_ID, TENANT, [])).resolves.toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("listEntriesForProduct short-circuits on an empty book list", async () => {
    withTx({ rows: [{ id: "e1" }] });
    await expect(priceBookRepo.listEntriesForProduct(TENANT, PRODUCT_ID, [BOOK_ID])).resolves.toHaveLength(1);
    await expect(priceBookRepo.listEntriesForProduct(TENANT, PRODUCT_ID, [])).resolves.toEqual([]);
  });
});
