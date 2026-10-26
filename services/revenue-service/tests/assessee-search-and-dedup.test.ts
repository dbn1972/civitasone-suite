/**
 * GAP-REVENUE-ASSESSEES-03 (sync 409 on duplicate identifier) and
 * GAP-REVENUE-ASSESSEES-04 (server-side search + exact total).
 *
 * DB-backed against the disposable test Postgres named by DATABASE_URL: the repo
 * functions run real SQL under the tenant GUC (RLS). Route-level 409 mapping is
 * covered in assessee-routes.test.ts with a mocked repo.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn(),
  },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const TENANT = "0000aaaa-0000-0000-0000-0000000004aa";
const OTHER = "0000aaaa-0000-0000-0000-0000000004ab";
const ACTOR = "0000bbbb-0000-0000-0000-0000000004bb";

async function seed(tenant: string, ident: string, owner: string) {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    await tx`INSERT INTO assessee.assessees (tenant_id, assessee_type, identifier_no, owner_name, address, created_by, updated_by)
             VALUES (${tenant}, 'property', ${ident}, ${owner}, 'Addr', ${ACTOR}, ${ACTOR})`;
  });
}

afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM assessee.assessees WHERE tenant_id = ${t}`;
    });
  }
  await sql.end();
});

describe("assessee repo (GAP-REVENUE-ASSESSEES-03/04)", () => {
  it("findAssesseeByIdentifier finds an existing identifier, tenant-scoped", async () => {
    const repo = await import("../src/modules/assessee/repo.js");
    await seed(TENANT, "ZZ-DUP-1", "Dup Owner");
    expect(await repo.findAssesseeByIdentifier(TENANT, "ZZ-DUP-1")).not.toBeNull();
    expect(await repo.findAssesseeByIdentifier(TENANT, "ZZ-DUP-NONE")).toBeNull();
    // same identifier under another tenant is not a duplicate
    expect(await repo.findAssesseeByIdentifier(OTHER, "ZZ-DUP-1")).toBeNull();
  });

  it("listAssessees q searches name/identifier beyond the first page with exact total", async () => {
    const repo = await import("../src/modules/assessee/repo.js");
    for (let i = 0; i < 205; i++) await seed(TENANT, `ZZ-BULK-${String(i).padStart(3, "0")}`, `Bulk Owner ${i}`);
    await seed(TENANT, "ZZ-LAST-100%", "Zed 100% Last");

    const byIdent = await repo.listAssessees(TENANT, { limit: 50, offset: 0 }, "ZZ-BULK-204");
    expect(byIdent.data).toHaveLength(1);
    expect(byIdent.meta.total).toBe(1);

    const byName = await repo.listAssessees(TENANT, { limit: 50, offset: 0 }, "bulk owner");
    expect(byName.meta.total).toBe(205);
    expect(byName.data).toHaveLength(50);
    const page2 = await repo.listAssessees(TENANT, { limit: 50, offset: 50 }, "bulk owner");
    expect(page2.meta.page).toBe(2);
    expect(page2.data[0]!.id).not.toBe(byName.data[0]!.id);

    // LIKE wildcards in the term are matched literally
    const wildcard = await repo.listAssessees(TENANT, { limit: 50, offset: 0 }, "100%");
    expect(wildcard.meta.total).toBe(1);
    const underscore = await repo.listAssessees(TENANT, { limit: 50, offset: 0 }, "ZZ_BULK");
    expect(underscore.meta.total).toBe(0);

    // tenant-wide summary is independent of q and counts the whole register
    expect(byName.meta.summary.total).toBe(207);
    expect(byName.meta.summary.property).toBe(207);
    expect(byName.meta.summary.other).toBe(0);
    expect(byName.meta.summary.active).toBe(207);

    // tenant isolation
    const other = await repo.listAssessees(OTHER, { limit: 50, offset: 0 }, "bulk owner");
    expect(other.meta.total).toBe(0);
  }, 60_000);
});
