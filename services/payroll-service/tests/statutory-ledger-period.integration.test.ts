/**
 * GAP-PAYROLL-STATUTORY-PF-03 / ESI-03 — PF/ESI ledger period filter,
 * ordering and per-period totals against real Postgres + real RLS.
 *
 * The PF/ESI pages used to sum an unordered first page (default limit 50) of
 * the whole ledger client-side and label it as one month's total. These tests
 * pin the repo contract the pages now rely on: newest period first, an exact
 * one-period filter, and SQL totals that cover every row of the period no
 * matter how many there are.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollPf, payrollEsi } from "../src/modules/statutory/schema.js";
import * as repo from "../src/modules/statutory/repo.js";

const TENANT = "90000000-f003-4000-8000-000000000001";
const OTHER_TENANT = "90000000-f003-4000-8000-000000000002";
const ACTOR = "00000000-0000-0000-0000-000000000099";
const RUN = "90000000-f003-4000-8000-0000000000aa";

const uuid = (n: number) => `90000000-f003-4000-8000-${n.toString(16).padStart(12, "0")}`;

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM statutory.payroll_pf WHERE tenant_id = ${t}::uuid`);
      await tx.execute(sql`DELETE FROM statutory.payroll_esi WHERE tenant_id = ${t}::uuid`);
    }));
  }
}

/** 60 rows for 2026-08 (more than the old default page of 50), 5 for 2026-07, 3 for 2026-06. */
async function seed(): Promise<void> {
  const rows: Array<{ period: string; n: number }> = [];
  let n = 1;
  for (let i = 0; i < 5; i++) rows.push({ period: "2026-07", n: n++ });
  for (let i = 0; i < 60; i++) rows.push({ period: "2026-08", n: n++ });
  for (let i = 0; i < 3; i++) rows.push({ period: "2026-06", n: n++ });
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollPf).values(rows.map((r) => ({
      tenantId: TENANT, slipId: uuid(1000 + r.n), employeeId: uuid(r.n), runId: RUN, period: r.period,
      basicMinor: 1_500_000n, empContribMinor: 180_000n, erContribMinor: 180_000n, createdBy: ACTOR, updatedBy: ACTOR,
    })));
    await tx.insert(payrollEsi).values(rows.map((r) => ({
      tenantId: TENANT, slipId: uuid(2000 + r.n), employeeId: uuid(r.n), runId: RUN, period: r.period,
      grossMinor: 2_000_000n, empContribMinor: 15_000n, erContribMinor: 65_000n, createdBy: ACTOR, updatedBy: ACTOR,
    })));
  }));
  // Another tenant's rows must never leak into the totals or the period list.
  await runWithTenant(OTHER_TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollPf).values({
      tenantId: OTHER_TENANT, slipId: uuid(9001), employeeId: uuid(9001), runId: RUN, period: "2026-09",
      empContribMinor: 999_999n, erContribMinor: 999_999n, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

beforeEach(async () => { await cleanup(); await seed(); });
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("PF/ESI ledger period contract (GAP-PAYROLL-STATUTORY-PF-03, ESI-03)", () => {
  it("lists newest period first", async () => {
    const rows = await runWithTenant(TENANT, () => repo.listPfByTenant(TENANT, 500));
    const periods = rows.map((r) => r.period);
    expect(periods).toEqual([...periods].sort().reverse());
    expect(periods[0]).toBe("2026-08");
    // Even a small page starts with the latest period, so the picker cannot miss it.
    const small = await runWithTenant(TENANT, () => repo.listEsiByTenant(TENANT, 10));
    expect(small.every((r) => r.period === "2026-08")).toBe(true);
  });

  it("?period filters to exactly that period's rows", async () => {
    const jul = await runWithTenant(TENANT, () => repo.listPfByTenant(TENANT, 500, "2026-07"));
    expect(jul).toHaveLength(5);
    expect(jul.every((r) => r.period === "2026-07")).toBe(true);
    const aug = await runWithTenant(TENANT, () => repo.listEsiByTenant(TENANT, 500, "2026-08"));
    expect(aug).toHaveLength(60);
  });

  it("PF summary totals every row of the period (60 rows > the old 50-row page), tenant-scoped", async () => {
    const s = await runWithTenant(TENANT, () => repo.summarisePfPeriod(TENANT));
    expect(s.periods).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(s.period).toBe("2026-08");
    expect(s.recordCount).toBe(60);
    expect(s.empContribMinor).toBe(60n * 180_000n);
    expect(s.erContribMinor).toBe(60n * 180_000n);
  });

  it("ESI summary honours a requested period and falls back to the latest for an unknown one", async () => {
    const jul = await runWithTenant(TENANT, () => repo.summariseEsiPeriod(TENANT, "2026-07"));
    expect(jul).toMatchObject({ period: "2026-07", recordCount: 5, empContribMinor: 75_000n, erContribMinor: 325_000n });
    const unknown = await runWithTenant(TENANT, () => repo.summariseEsiPeriod(TENANT, "2020-01"));
    expect(unknown.period).toBe("2026-08");
    expect(unknown.recordCount).toBe(60);
  });

  it("an empty ledger summarises to no period and zero totals", async () => {
    const s = await runWithTenant(OTHER_TENANT, () => repo.summariseEsiPeriod(OTHER_TENANT));
    expect(s).toEqual({ periods: [], period: null, recordCount: 0, empContribMinor: 0n, erContribMinor: 0n });
  });
});
