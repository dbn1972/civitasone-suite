/**
 * Repo-level tests for catalogue-service.
 * Drizzle query builders are exercised against a fake transaction — no database
 * connection. Focus: the optimistic-locking contract (update/softDelete return
 * false when no row matched the expected version) and read helpers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const PRODUCT_ID = "11111111-1111-4000-8000-000000000001";
const RATE_ID = "22222222-2222-4000-8000-000000000001";
const RULE_ID = "33333333-3333-4000-8000-000000000001";
const BUNDLE_ID = "44444444-4444-4000-8000-000000000001";
const ACTOR = "00000000-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: {},
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

import * as productRepo from "../src/modules/products/repo.js";
import * as rateRepo from "../src/modules/rates/repo.js";
import * as eligRepo from "../src/modules/eligibility/repo.js";
import * as bundleRepo from "../src/modules/bundles/repo.js";
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

/** Fake transaction: `select` serves rows (or counts), `update` serves returning rows. */
function fakeTx(opts: FakeTxOptions = {}): ScopedTx {
  const { rows = [], count = rows.length, returning = [] } = opts;
  const tx = {
    select: (projection?: Record<string, unknown>) =>
      projection && "count" in projection ? chain([{ count }]) : chain(rows),
    insert: () => chain(undefined),
    update: () => chain(returning),
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

describe("products/repo", () => {
  it("findById returns the row when present, null otherwise", async () => {
    withTx({ rows: [{ id: PRODUCT_ID }] });
    await expect(productRepo.findById(PRODUCT_ID, TENANT)).resolves.toEqual({ id: PRODUCT_ID });
    withTx({ rows: [] });
    await expect(productRepo.findById(PRODUCT_ID, TENANT)).resolves.toBeNull();
  });

  it("listProducts applies every optional filter and returns the total", async () => {
    withTx({ rows: [{ id: PRODUCT_ID }], count: 7 });
    const res = await productRepo.listProducts({
      tenantId: TENANT,
      limit: 10,
      offset: 0,
      lifecycleStatus: "active",
      lineId: PRODUCT_ID,
      search: "sav",
    });
    expect(res.total).toBe(7);
  });

  it("listByTenant and findByIds read through scopedRead", async () => {
    withTx({ rows: [{ id: PRODUCT_ID }] });
    await expect(productRepo.listByTenant(TENANT)).resolves.toHaveLength(1);
    await expect(productRepo.findByIds([PRODUCT_ID], TENANT)).resolves.toHaveLength(1);
    await expect(productRepo.findByIds([], TENANT)).resolves.toEqual([]);
  });

  it("insertProduct writes through the supplied transaction", async () => {
    const tx = fakeTx();
    const insertSpy = vi.spyOn(tx, "insert");
    await productRepo.insertProduct(tx, {
      id: PRODUCT_ID,
      tenantId: TENANT,
      name: "Savings",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    expect(insertSpy).toHaveBeenCalledOnce();
  });

  it("updateProduct returns true only when a row came back", async () => {
    await expect(
      productRepo.updateProduct(fakeTx({ returning: [{ id: PRODUCT_ID }] }), PRODUCT_ID, TENANT, { name: "x" }, 1),
    ).resolves.toBe(true);
    await expect(
      productRepo.updateProduct(fakeTx({ returning: [] }), PRODUCT_ID, TENANT, { name: "x" }, 1),
    ).resolves.toBe(false);
  });

  it("softDelete returns false on a version mismatch", async () => {
    await expect(
      productRepo.softDelete(fakeTx({ returning: [{ id: PRODUCT_ID }] }), PRODUCT_ID, TENANT, 1),
    ).resolves.toBe(true);
    await expect(productRepo.softDelete(fakeTx({ returning: [] }), PRODUCT_ID, TENANT, 99)).resolves.toBe(false);
  });
});

describe("rates/repo", () => {
  it("findById and findCurrentRate return null when nothing matches", async () => {
    withTx({ rows: [] });
    await expect(rateRepo.findById(RATE_ID, TENANT)).resolves.toBeNull();
    await expect(rateRepo.findCurrentRate(PRODUCT_ID, TENANT)).resolves.toBeNull();
    withTx({ rows: [{ id: RATE_ID }] });
    await expect(rateRepo.findCurrentRate(PRODUCT_ID, TENANT)).resolves.toEqual({ id: RATE_ID });
  });

  it("listRates supports the optional date filter", async () => {
    withTx({ rows: [{ id: RATE_ID }], count: 3 });
    const res = await rateRepo.listRates({
      tenantId: TENANT,
      productId: PRODUCT_ID,
      limit: 10,
      offset: 0,
      date: "2025-01-01",
    });
    expect(res.total).toBe(3);
  });

  it("insertRate writes and updateRate reports the optimistic-lock outcome", async () => {
    const tx = fakeTx();
    const insertSpy = vi.spyOn(tx, "insert");
    await rateRepo.insertRate(tx, {
      id: RATE_ID,
      tenantId: TENANT,
      productId: PRODUCT_ID,
      effectiveDate: "2025-01-01",
      rateValue: 5000n,
      source: "RBI",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    expect(insertSpy).toHaveBeenCalledOnce();

    await expect(
      rateRepo.updateRate(fakeTx({ returning: [{ id: RATE_ID }] }), RATE_ID, TENANT, { source: "x" }, 1),
    ).resolves.toBe(true);
    await expect(
      rateRepo.updateRate(fakeTx({ returning: [] }), RATE_ID, TENANT, { source: "x" }, 1),
    ).resolves.toBe(false);
  });
});

describe("eligibility/repo", () => {
  it("read helpers return rows and short-circuit on an empty id list", async () => {
    withTx({ rows: [{ id: RULE_ID }] });
    await expect(eligRepo.findById(RULE_ID, TENANT)).resolves.toEqual({ id: RULE_ID });
    await expect(eligRepo.listByProduct(PRODUCT_ID, TENANT)).resolves.toHaveLength(1);
    await expect(eligRepo.listByProducts([PRODUCT_ID], TENANT)).resolves.toHaveLength(1);
    await expect(eligRepo.listByProducts([], TENANT)).resolves.toEqual([]);
  });

  it("insertRule writes and deleteRule returns whether a row was soft-deleted", async () => {
    const tx = fakeTx();
    const insertSpy = vi.spyOn(tx, "insert");
    await eligRepo.insertRule(tx, {
      id: RULE_ID,
      tenantId: TENANT,
      productId: PRODUCT_ID,
      ruleType: "age_range",
      criteria: { minAge: 18 },
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    expect(insertSpy).toHaveBeenCalledOnce();

    await expect(eligRepo.deleteRule(fakeTx({ returning: [{ id: RULE_ID }] }), RULE_ID, TENANT)).resolves.toBe(true);
    await expect(eligRepo.deleteRule(fakeTx({ returning: [] }), RULE_ID, TENANT)).resolves.toBe(false);
  });
});

describe("bundles/repo", () => {
  it("findById and listBundles read through scopedRead", async () => {
    withTx({ rows: [{ id: BUNDLE_ID }], count: 1 });
    await expect(bundleRepo.findById(BUNDLE_ID, TENANT)).resolves.toEqual({ id: BUNDLE_ID });
    const res = await bundleRepo.listBundles({ tenantId: TENANT, limit: 10, offset: 0 });
    expect(res.total).toBe(1);
    withTx({ rows: [] });
    await expect(bundleRepo.findById(BUNDLE_ID, TENANT)).resolves.toBeNull();
  });

  it("insertBundle writes; updateBundle / softDeleteBundle report the lock outcome", async () => {
    const tx = fakeTx();
    const insertSpy = vi.spyOn(tx, "insert");
    await bundleRepo.insertBundle(tx, {
      id: BUNDLE_ID,
      tenantId: TENANT,
      name: "Bundle",
      componentProductIds: [PRODUCT_ID],
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    expect(insertSpy).toHaveBeenCalledOnce();

    await expect(
      bundleRepo.updateBundle(fakeTx({ returning: [{ id: BUNDLE_ID }] }), BUNDLE_ID, TENANT, { name: "x" }, 1),
    ).resolves.toBe(true);
    await expect(
      bundleRepo.updateBundle(fakeTx({ returning: [] }), BUNDLE_ID, TENANT, { name: "x" }, 1),
    ).resolves.toBe(false);
    await expect(
      bundleRepo.softDeleteBundle(fakeTx({ returning: [{ id: BUNDLE_ID }] }), BUNDLE_ID, TENANT, 1),
    ).resolves.toBe(true);
    await expect(bundleRepo.softDeleteBundle(fakeTx({ returning: [] }), BUNDLE_ID, TENANT, 1)).resolves.toBe(false);
  });
});
