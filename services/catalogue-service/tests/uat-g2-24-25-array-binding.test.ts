/**
 * UAT G2 #24/#25 regression: an array interpolated into sql`... = ANY(${ids})` is expanded by drizzle into
 * scalar params (`ANY($1, $2)`), which Postgres rejects (500 on POST /bundles and POST /eligibility/check).
 * The fake-tx repo tests could not see this, so these render the actual WHERE clause to SQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const P1 = "11111111-1111-4000-8000-000000000001";
const P2 = "11111111-1111-4000-8000-000000000002";

const H = vi.hoisted(() => ({ scopedReadMock: vi.fn() }));
vi.mock("../src/shared/db.js", () => ({
  db: {},
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

import * as productRepo from "../src/modules/products/repo.js";
import * as eligRepo from "../src/modules/eligibility/repo.js";

let whereArg: SQL | undefined;
function capturingTx(): unknown {
  const node: Record<string, unknown> = {};
  for (const m of ["select", "from", "orderBy", "limit", "offset"]) node[m] = () => node;
  node["where"] = (w: SQL) => { whereArg = w; return node; };
  node["then"] = (ok: (v: unknown) => unknown) => Promise.resolve([]).then(ok);
  return node;
}
function rendered(): { sql: string; params: unknown[] } {
  expect(whereArg).toBeDefined();
  return new PgDialect().sqlToQuery(whereArg as SQL);
}

beforeEach(() => {
  whereArg = undefined;
  H.scopedReadMock.mockReset();
  H.scopedReadMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(capturingTx()));
});

describe("array binding in catalogue id-list queries", () => {
  it("products.findByIds binds the id list as an IN list, never ANY(<expanded scalars>)", async () => {
    await productRepo.findByIds([P1, P2], TENANT);
    const q = rendered();
    expect(q.sql).not.toMatch(/ANY\(/i);
    expect(q.sql).toMatch(/"id" in \(\$\d+, \$\d+\)/i);
    expect(q.params).toEqual(expect.arrayContaining([TENANT, P1, P2]));
  });

  it("products.findByIds works for a single id", async () => {
    await productRepo.findByIds([P1], TENANT);
    const q = rendered();
    expect(q.sql).not.toMatch(/ANY\(/i);
    expect(q.params).toEqual(expect.arrayContaining([P1]));
  });

  it("products.findByIds short-circuits an empty list without querying", async () => {
    expect(await productRepo.findByIds([], TENANT)).toEqual([]);
    expect(H.scopedReadMock).not.toHaveBeenCalled();
  });

  it("eligibility.listByProducts binds the product-id list as an IN list", async () => {
    await eligRepo.listByProducts([P1, P2], TENANT);
    const q = rendered();
    expect(q.sql).not.toMatch(/ANY\(/i);
    expect(q.sql).toMatch(/"product_id" in \(\$\d+, \$\d+\)/i);
    expect(q.params).toEqual(expect.arrayContaining([TENANT, P1, P2]));
  });

  it("eligibility.listByProducts short-circuits an empty list without querying", async () => {
    expect(await eligRepo.listByProducts([], TENANT)).toEqual([]);
    expect(H.scopedReadMock).not.toHaveBeenCalled();
  });
});
