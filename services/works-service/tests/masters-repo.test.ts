/**
 * Regression test for the masters/repo.ts `table._.name` crash.
 *
 * Bug: listMaster()/getMaster() built their cache key with
 * `table._.name` — drizzle-orm's internal accessor, which is undefined on
 * the installed drizzle-orm@0.30 pg-core table proxy. Every call threw
 * `TypeError: Cannot read properties of undefined (reading 'name')` before
 * ever reaching the DB, so the entire `/v1/works/masters/*` read surface
 * (list AND detail, all 17 master types) 500'd unconditionally — confirmed
 * live via the gateway during the works deep-verify pass (masters/repo.ts
 * threw at the same `table._.name` expression masters/consumer.ts already
 * carries a fix + comment for, but that fix was never mirrored into
 * repo.ts). Fix: use the public `getTableName(table)` API, same as
 * consumer.ts already does.
 *
 * This test uses the REAL schema table objects (not fakes) — the bug only
 * reproduces against the actual drizzle-orm table proxy, not a stand-in —
 * with the DB/cache layers mocked so no live Postgres/Redis is required.
 */
import { describe, it, expect, vi } from "vitest";
import { masters } from "../src/modules/masters/registry.js";

const sampleRow = { id: "11111111-1111-4111-8111-111111111111", name: "Sample", code: "S1", active: true };

vi.mock("@civitasone/db", () => {
  const fakeTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            offset: () => Promise.resolve([sampleRow]),
          }),
          // getMaster's chain has no .limit()/.offset() — `where(...)` is awaited directly.
          then: (resolve: (rows: typeof sampleRow[]) => unknown) => resolve([sampleRow]),
        }),
      }),
    }),
  };
  return {
    createTenantDb: () => ({
      sqlClient: { end: vi.fn() },
      db: { transaction: (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx) },
      dbFor: vi.fn(),
      sqlClientFor: vi.fn(),
      tierOf: vi.fn(),
      dbForRead: vi.fn(),
    }),
  };
});

vi.mock("@civitasone/cache", () => ({
  // Bypass caching entirely — just run the loader, matching the convention
  // already used in tests/reporting-aggregates.test.ts.
  Cache: class {
    getOrLoad(_key: string, fn: () => unknown) {
      return fn();
    }
    invalidate() {
      return Promise.resolve();
    }
  },
}));

describe("masters/repo.ts — getTableName regression", () => {
  it("listMaster() resolves (not throws) for every one of the 17 registered master tables", async () => {
    const { listMaster } = await import("../src/modules/masters/repo.js");
    for (const m of masters) {
      await expect(
        listMaster(m.table, "11111111-0000-0000-0000-000000000001", 1, 20),
        `listMaster threw for prefix "${m.prefix}"`,
      ).resolves.toEqual([sampleRow]);
    }
  });

  it("getMaster() resolves (not throws) for every one of the 17 registered master tables", async () => {
    const { getMaster } = await import("../src/modules/masters/repo.js");
    for (const m of masters) {
      await expect(
        getMaster(m.table, "11111111-0000-0000-0000-000000000001", sampleRow.id),
        `getMaster threw for prefix "${m.prefix}"`,
      ).resolves.toEqual(sampleRow);
    }
  });
});
