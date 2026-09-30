/**
 * GAP-HR-JD-TEMPLATES-02 regression test -- real-DB round-trip.
 *
 * Before this fix, listTemplates() applied `vacancyType` as a JS `.filter()`
 * AFTER `.limit(opts.limit ?? 100)` had already truncated the SQL result to
 * the top 100 rows (ordered by use_count DESC, created_at DESC). With more
 * than 100 templates total, a filtered view could silently miss matches that
 * exist past row 100 of the *unfiltered* ordering. This seeds exactly that
 * shape: 100 "regular" templates with use_count=1 (sorting ahead of) plus 5
 * "deputation" templates with use_count=0 (sorting after all 100) -- under
 * the old code, `listTemplates(tenantId, { vacancyType: "deputation" })`
 * would return zero rows (all 5 fall outside the pre-filter top-100 window);
 * the fix moves the filter into the SQL WHERE clause so it returns all 5.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { withRawTenantGuc } from "@civitasone/db";
import { sqlClient } from "../../shared/db.js";
import * as templateRepo from "./jd-template-repo.js";

const TENANT = "facade00-1d70-4000-8000-0000000000d1";
const SEED_ACTOR = "facade00-1d70-4000-8000-0000000000aa";

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM recruitment.hrms_jd_templates WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  // 100 higher-priority "regular" templates -- these alone fill the
  // pre-fix code's top-100 window entirely.
  for (let i = 0; i < 100; i++) {
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_jd_templates
        (id, tenant_id, name, vacancy_type, use_count, created_by, updated_by)
      VALUES
        (gen_random_uuid(), ${TENANT}, ${"Regular Template " + i}, 'regular', 1, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  // 5 lower-priority "deputation" templates -- sort after all 100 above
  // (use_count 0 < 1), so a `.limit(100)` applied before filtering would
  // never see them.
  for (let i = 0; i < 5; i++) {
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_jd_templates
        (id, tenant_id, name, vacancy_type, use_count, created_by, updated_by)
      VALUES
        (gen_random_uuid(), ${TENANT}, ${"Deputation Template " + i}, 'deputation', 0, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
});

afterAll(async () => {
  await cleanup();
});

describe("jd-template-repo listTemplates", () => {
  it("returns all matching rows for a filtered type even when more than `limit` unfiltered rows exist", async () => {
    const rows = await runWithTenant(TENANT, () =>
      templateRepo.listTemplates(TENANT, { vacancyType: "deputation" }),
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.vacancyType === "deputation")).toBe(true);
  });

  it("still respects the limit for an unfiltered listing", async () => {
    const rows = await runWithTenant(TENANT, () =>
      templateRepo.listTemplates(TENANT, { limit: 10 }),
    );
    expect(rows).toHaveLength(10);
  });

  it("combines a type filter with a limit correctly (filter applied before truncation)", async () => {
    const rows = await runWithTenant(TENANT, () =>
      templateRepo.listTemplates(TENANT, { vacancyType: "deputation", limit: 3 }),
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.vacancyType === "deputation")).toBe(true);
  });
});
