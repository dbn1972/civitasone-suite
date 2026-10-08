/**
 * GAP2-PROCUREMENT-GAPLIST-03 — list endpoints must report meta.total /
 * total as a real COUNT(*) over the tenant-filtered set, NOT the length of
 * the already-paginated page.
 *
 * Before the fix every list route returned `total: data.length` / `rows.length`
 * (the capped page), so a tenant with more rows than the page size saw an
 * undercounted headline. These tests seed 55 rows and assert the new
 * count helpers return 55 while the paginated list returns only 50 — they
 * fail on the old code because the count helpers did not exist and the route
 * total equalled the page length.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import * as blRepo from "../src/modules/vendor-blacklist/repo.js";

const TENANT = "3c111111-aaaa-4000-8000-00000000a001";
const OTHER_TENANT = "3c111111-bbbb-4000-8000-00000000a002";

async function clean() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction((tx) =>
      tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, t))));
  }
  // central rows are visible cross-tenant; purge any left from a prior run
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    const rows = await tx.select({ id: vendorBlacklist.id }).from(vendorBlacklist);
    for (const r of rows) await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.id, r.id));
  }));
}

beforeAll(() => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32chars!!"; // gitleaks:allow
  process.env.PII_KEY_ID = "k1";
});
beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

async function seedActive(tenantId: string, count: number, scope: "tenant" | "central"): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      await blRepo.insertBlacklist({
        tenantId,
        vendorId: randomUUID(),
        scope,
        pan: `ABCDE${String(1000 + i).slice(-4)}F`,
        reason: `seed ${i}`,
        blacklistedBy: randomUUID(),
        createdBy: randomUUID(),
        blacklistedFrom: "2026-01-01",
        status: "active",
      }, tx);
    }
  }));
}

describe("GAP2-PROCUREMENT-GAPLIST-03 — total is COUNT(*), not page length", () => {
  it("countActiveByTenant returns the full dataset size (55) while the page is capped at 50", async () => {
    await seedActive(TENANT, 55, "tenant");

    const page = await runWithTenant(TENANT, () => blRepo.listActiveByTenant(TENANT, 50, 0));
    const total = await runWithTenant(TENANT, () => blRepo.countActiveByTenant(TENANT));

    // The old code's `total: rows.length` would have been 50 here — the bug.
    expect(page.length).toBe(50);
    expect(total).toBe(55);
  });

  it("countActiveByTenant is tenant-scoped (another tenant's rows do not inflate the count)", async () => {
    await seedActive(TENANT, 10, "tenant");
    await seedActive(OTHER_TENANT, 7, "tenant");

    const total = await runWithTenant(TENANT, () => blRepo.countActiveByTenant(TENANT));
    const otherTotal = await runWithTenant(OTHER_TENANT, () => blRepo.countActiveByTenant(OTHER_TENANT));
    expect(total).toBe(10);
    expect(otherTotal).toBe(7);
  });

  it("countActiveCentral returns the full central dataset size (55), not the capped page", async () => {
    await seedActive(TENANT, 55, "central");

    const page = await runWithTenant(TENANT, () => blRepo.listActiveCentral(50, 0));
    const total = await runWithTenant(TENANT, () => blRepo.countActiveCentral());

    expect(page.length).toBe(50);
    expect(total).toBe(55);
  });
});
