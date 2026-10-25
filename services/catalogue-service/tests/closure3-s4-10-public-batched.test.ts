/**
 * CLOS3-S4-10: the public catalogue projection must not issue one query per product.
 * Mock-based (no DB): scopedRead is replaced by a counter that runs the REAL governance-repo
 * query builders against a fake transaction whose rows are chosen by table.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const USER = "00000000-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  scopedReadCalls: 0,
  tables: new Map<unknown, unknown[]>(),
  products: [] as unknown[],
}));

vi.mock("../src/shared/db.js", () => {
  /** Chainable Drizzle stub: `.from(table)` picks the rows, everything else is a no-op. */
  const chain = (rowsFor: () => unknown[]) => {
    let table: unknown;
    const node: Record<string, unknown> = {};
    for (const m of ["where", "limit", "orderBy", "offset"]) node[m] = () => node;
    node["from"] = (t: unknown) => { table = t; return node; };
    node["then"] = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(H.tables.get(table) ?? rowsFor()).then(ok, bad);
    return node;
  };
  const tx = {
    select: () => chain(() => []),
    selectDistinct: () => chain(() => []),
    selectDistinctOn: () => chain(() => []),
  };
  return {
    db: { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
    scopedRead: (fn: (t: unknown) => Promise<unknown>) => { H.scopedReadCalls += 1; return fn(tx); },
    sqlClient: { end: async () => {} },
  };
});
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (_k: string, loader: () => Promise<unknown>) => loader(),
    invalidate: vi.fn(),
    makeKey: (t: string, r: string, id: string) => `catalogue:${t}:${r}:${id}`,
  },
  queue: { publish: vi.fn() },
}));
vi.mock("../src/modules/products/repo.js", () => ({
  findById: vi.fn(),
  findByIds: async () => H.products,
  updateProduct: vi.fn(),
  listProducts: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  listByTenant: vi.fn().mockResolvedValue([]),
  insertProduct: vi.fn(),
  softDelete: vi.fn(),
}));

import { buildApp } from "../src/app.js";
import { productLifecycle, productVersions } from "../src/modules/products/governance-schema.js";

const pid = (i: number) => `11111111-1111-4000-8000-${String(i).padStart(12, "0")}`;

function seed(n: number): void {
  const ids = Array.from({ length: n }, (_, i) => pid(i + 1));
  H.products = ids.map((id, i) => ({
    id, tenantId: TENANT, name: `Product ${String(i).padStart(3, "0")}`, description: null,
    lineId: null, familyId: null, parentId: null, lifecycleStatus: "active",
    effectiveFrom: null, effectiveTo: null, regulatoryMetadata: {}, productCode: `P-${i}`,
    category: "deposits", taxRateBps: 0, version: 1,
  }));
  H.tables.set(productLifecycle, ids.map((productId) => ({ productId, state: "active" })));
  H.tables.set(productVersions, ids.map((productId) => ({ productId, versionNumber: 2, status: "approved" })));
}

async function listCalls(n: number): Promise<{ calls: number; body: { data: Array<{ approvedVersionNumber: number }> } }> {
  seed(n);
  H.scopedReadCalls = 0;
  const app = await buildApp();
  const token = signToken({ sub: USER, tid: TENANT, roles: ["catalogue_user"], sid: "s" }, SECRET);
  const res = await app.inject({
    method: "GET",
    url: "/v1/catalogue/public/products?limit=200",
    headers: { authorization: `Bearer ${token}` },
  });
  await app.close();
  expect(res.statusCode).toBe(200);
  return { calls: H.scopedReadCalls, body: res.json() };
}

describe("CLOS3-S4-10 public catalogue query count", () => {
  beforeEach(() => { H.tables.clear(); H.products = []; });

  it("issues the same number of scopedRead calls for 1 and 50 publishable products", async () => {
    const one = await listCalls(1);
    const fifty = await listCalls(50);
    expect(one.body.data).toHaveLength(1);
    expect(fifty.body.data).toHaveLength(50);
    expect(fifty.calls).toBe(one.calls);
  });

  it("keeps the projection unchanged: approved version number comes from the batched lookup", async () => {
    const { body } = await listCalls(3);
    expect(body.data.map((d) => d.approvedVersionNumber)).toEqual([2, 2, 2]);
  });
});
