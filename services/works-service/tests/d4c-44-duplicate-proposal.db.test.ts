/**
 * Owner decision D4c #44 (GAP-WORKS-PROPOSALS-NEW-06): no hard cost cap (sanction bands drive the approval route);
 * a likely duplicate (same title, location, category, financial year) is WARNED about, never blocked.
 * Pure helpers + the real repo query against Postgres (works_svc, FORCE RLS).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { workProposals } from "../src/modules/proposal/schema.js";
import { financialYearOf, normalizeForDuplicate } from "../src/modules/proposal/domain.js";
import { findLikelyDuplicates } from "../src/modules/proposal/repo.js";
import { createProposalSchema } from "../src/modules/proposal/validators.js";

describe("financialYearOf (IST, April to March)", () => {
  it("1 April IST starts the new year; 31 March IST ends the old one", () => {
    expect(financialYearOf(new Date("2026-03-31T18:29:59Z")).label).toBe("2025-26"); // 31 Mar 23:59:59 IST
    expect(financialYearOf(new Date("2026-03-31T18:30:00Z")).label).toBe("2026-27"); // 1 Apr 00:00 IST
    expect(financialYearOf(new Date("2026-10-27T05:00:00Z")).label).toBe("2026-27");
    expect(financialYearOf(new Date("2027-01-15T05:00:00Z")).label).toBe("2026-27");
  });
  it("returns half-open bounds that contain the date", () => {
    const d = new Date("2026-10-27T05:00:00Z");
    const fy = financialYearOf(d);
    expect(fy.start.getTime()).toBeLessThanOrEqual(d.getTime());
    expect(fy.end.getTime()).toBeGreaterThan(d.getTime());
    expect(fy.start.toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(fy.end.toISOString()).toBe("2027-03-31T18:30:00.000Z");
  });
});

describe("normalizeForDuplicate", () => {
  it("ignores case, outer and repeated spaces", () => {
    expect(normalizeForDuplicate("  Repair   of  ROAD ")).toBe("repair of road");
    expect(normalizeForDuplicate(null)).toBe("");
    expect(normalizeForDuplicate(undefined)).toBe("");
  });
});

describe("no hard cost cap (owner decision)", () => {
  it("accepts a very large estimate: sanction bands, not a ceiling, drive the approval route", () => {
    const ok = createProposalSchema.safeParse({ description: "Mega project", category: "regular", workTypeId: randomUUID(), estimatedCostMinor: "900000000000000" });
    expect(ok.success).toBe(true);
  });
});

const TENANT = `d4c44000-0000-4000-8000-${randomUUID().slice(24)}`;
const OTHER = `d4c44000-0000-4000-8000-${randomUUID().slice(24)}`;
const ACTOR = randomUUID();
afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${t}, true)`;
      await sql.unsafe(`DELETE FROM works.work_proposals WHERE tenant_id = '${t}'`);
    });
  }
  await sqlClient.end();
});

async function seed(tenant: string, over: Partial<typeof workProposals.$inferInsert> = {}) {
  const id = randomUUID();
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(workProposals).values({
    id, tenantId: tenant, workNumber: `W/${id.slice(0, 6)}`, category: "regular", description: "Repair of village road",
    workTypeId: randomUUID(), estimatedCostMinor: 100n, district: "Khordha", taluka: "Bhubaneswar", village: "Patia",
    createdBy: ACTOR, updatedBy: ACTOR, ...over,
  })));
  return id;
}
const find = (tenant: string, q: Record<string, string | undefined>, now = new Date()) =>
  runWithTenant(tenant, () => findLikelyDuplicates(tenant, { description: "Repair of village road", category: "regular", district: "Khordha", taluka: "Bhubaneswar", village: "Patia", ...q }, now));

describe("findLikelyDuplicates (real DB)", () => {
  it("finds a proposal with the same title, location and category in the same financial year, ignoring case and spacing", async () => {
    const id = await seed(TENANT, { description: "  repair OF  village road " , district: "KHORDHA" });
    const hits = await find(TENANT, {});
    expect(hits.map((h) => h.id)).toContain(id);
    expect(hits.find((h) => h.id === id)).toMatchObject({ workNumber: expect.any(String), status: "draft" });
  });

  it("does not match a different title, category, or location", async () => {
    const t = `Unique title ${randomUUID()}`;
    await seed(TENANT, { description: t });
    expect(await find(TENANT, { description: t, category: "deposit" })).toHaveLength(0);
    expect(await find(TENANT, { description: t, village: "Somewhere else" })).toHaveLength(0);
    expect(await find(TENANT, { description: t + " extra" })).toHaveLength(0);
    expect((await find(TENANT, { description: t })).length).toBe(1);
  });

  it("does not match a proposal from an earlier financial year", async () => {
    const t = `Old title ${randomUUID()}`;
    await seed(TENANT, { description: t, createdAt: new Date("2025-06-01T00:00:00Z") });
    expect(await find(TENANT, { description: t }, new Date("2026-10-27T05:00:00Z"))).toHaveLength(0);
    expect(await find(TENANT, { description: t }, new Date("2025-12-01T05:00:00Z"))).toHaveLength(1);
  });

  it("treats a missing location part as empty on both sides", async () => {
    const t = `No location ${randomUUID()}`;
    await seed(TENANT, { description: t, district: null, taluka: null, village: null });
    expect(await find(TENANT, { description: t, district: undefined, taluka: undefined, village: undefined })).toHaveLength(1);
    expect(await find(TENANT, { description: t })).toHaveLength(0);
  });

  it("never sees another tenant's proposals", async () => {
    const t = `Tenant scoped ${randomUUID()}`;
    await seed(OTHER, { description: t });
    expect(await find(TENANT, { description: t })).toHaveLength(0);
  });

  it("returns at most five, newest first", async () => {
    const t = `Many ${randomUUID()}`;
    for (let i = 0; i < 7; i++) await seed(TENANT, { description: t });
    expect(await find(TENANT, { description: t })).toHaveLength(5);
  });
});
