/**
 * PERF-005 tranche 2 regression test — crm-service.
 *
 * NOTE ON SCOPE: crm-service was not named at all in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's original PERF-005/PERF-019 rows.
 * This is a newly-discovered N+1 found by an independent codebase-wide grep
 * for the same anti-pattern (`Promise.all(rows.map(async ...))` doing a
 * per-row DB call after an initial list query). See this tranche's PR
 * description for the full list of newly-discovered sites.
 *
 * Covers:
 *   - price-books/routes.ts's GET /v1/crm/price-books (was N+1 via
 *     repo.listItems() per book row)
 *
 * Goes through the real HTTP boundary (buildApp + inject) since the fix
 * lives entirely in routes.ts + repo.ts, both raw-SQL (no drizzle schema.ts
 * for this module). Query counting uses the real driver-level counter from
 * @civitasone/db (countQueriesDuring), only counting anything when
 * DB_QUERY_DEBUG=true is set at test-run time — mirrors PERF-005/PERF-019's
 * own test files.
 *
 * NO warm-up step (unlike this tranche's admin/court/procurement sibling
 * tests): listItemsByBookIds binds each id as its own `${id}::uuid` scalar
 * inside a manually-built `ARRAY[$1::uuid, $2::uuid, ...]` SQL literal, not
 * drizzle's inArray() (there is no drizzle schema.ts for this module -- see
 * repo.ts). postgres-js's one-time element-type OID lookup is specifically
 * triggered by binding a plain JS array as a SINGLE parameter (what
 * inArray() does); N individually-bound scalars never hit that path.
 * Confirmed empirically: stable (green, no query-count drift) across
 * repeated local runs with no warm-up added.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { countQueriesDuring } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const SMALL_N = 3;
const LARGE_N = 20;

function token(tenant: string) {
  return signToken({ sub: ACTOR, tid: tenant, roles: ["crm_admin", "super_admin"], sid: "sess-perf005t2" }, SECRET);
}

async function seed(tenant: string, n: number) {
  const books = Array.from({ length: n }, (_, i) => ({ id: randomUUID(), name: `Price Book ${i}` }));
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    for (const [i, book] of books.entries()) {
      await sql`
        INSERT INTO crm.price_books (id, tenant_id, name, priority, enabled, created_by, updated_by)
        VALUES (${book.id}, ${tenant}, ${book.name}, ${i}, true, ${ACTOR}, ${ACTOR})`;
      // 2 items per book, so a broken batch loader (or one that drops items
      // for any book) is visible per-row, not just in aggregate.
      for (let j = 0; j < 2; j++) {
        await sql`
          INSERT INTO crm.price_book_items (id, tenant_id, price_book_id, product_id, price_minor, created_by, updated_by)
          VALUES (${randomUUID()}, ${tenant}, ${book.id}, ${randomUUID()}, ${1000 + j}, ${ACTOR}, ${ACTOR})`;
      }
    }
  });
  return { books };
}

async function wipe(tenant: string) {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    await sql`DELETE FROM crm.price_book_items WHERE tenant_id = ${tenant}`;
    await sql`DELETE FROM crm.price_books WHERE tenant_id = ${tenant}`;
  });
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("PERF-005 tranche 2 — crm-service N+1 fix", () => {
  it("GET /v1/crm/price-books: query count is O(1) not O(N), each book's items stay correct (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      const { result: resSmall, queryCount: countSmall } = await countQueriesDuring(() => app.inject({
        method: "GET", url: "/v1/crm/price-books?limit=50",
        headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
      }));
      const { result: resLarge, queryCount: countLarge } = await countQueriesDuring(() => app.inject({
        method: "GET", url: "/v1/crm/price-books?limit=50",
        headers: { authorization: `Bearer ${token(tenantLarge)}`, "x-tenant-id": tenantLarge },
      }));

      expect(resSmall.statusCode).toBe(200);
      expect(resLarge.statusCode).toBe(200);

      // O(1): identical round-trip count whether the tenant has 3 price
      // books or 20. The old per-book repo.listItems() loop would have made
      // ~17 more queries for the 20-book tenant than the 3-book one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      const body = resLarge.json() as { data: Array<{ id: string; items: Array<{ priceBookId: string; productId: string; priceMinor: string }> }> };
      const bookIds = new Set(large.books.map((b) => b.id));
      const ourRows = body.data.filter((r) => bookIds.has(r.id));
      expect(ourRows).toHaveLength(LARGE_N);
      for (const row of ourRows) {
        expect(row.items).toHaveLength(2);
        for (const item of row.items) expect(item.priceBookId).toBe(row.id);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
