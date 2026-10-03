/**
 * GAP-HR-LEAVE-APPLY-05 -- the LOP ledger accepts half-day amounts (real DB).
 *
 * The integer lop_days column is not altered; the NEW numeric lop_days_exact
 * column carries the exact figure once a fraction lands. Readers sum
 * COALESCE(lop_days_exact, lop_days), so whole-day-only rows behave exactly as
 * before and a half day is never rounded up or lost.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollLopLedger } from "../src/modules/integration/schema.js";
import * as lopRepo from "../src/modules/integration/lop-repo.js";

const TENANT = "90000000-dead-4000-8000-0000000a0a05";
const EMP = randomUUID();
const MONTH = "2026-10";

const scoped = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function cleanup(): Promise<void> {
  await scoped((tx) => tx.delete(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT)));
}
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("payroll_lop_ledger with half days", () => {
  it("whole days keep using the integer column only (lop_days_exact stays NULL)", async () => {
    await scoped((tx) => lopRepo.upsertLopDays(tx, TENANT, EMP, MONTH, "leave", 2));
    await scoped((tx) => lopRepo.upsertLopDays(tx, TENANT, EMP, MONTH, "leave", 1));
    const rows = await scoped((tx) => tx.select().from(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lopDays).toBe(3);
    expect(rows[0]!.lopDaysExact).toBeNull();
    expect((await runWithTenant(TENANT, () => lopRepo.getLopForMonth(TENANT, EMP, MONTH))).days).toBe(3);
  });

  it("a half day lands in lop_days_exact; lop_days keeps FLOOR; the sum reads the exact value", async () => {
    await scoped((tx) => lopRepo.upsertLopDays(tx, TENANT, EMP, MONTH, "leave", 0.5));
    const rows = await scoped((tx) => tx.select().from(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT)));
    expect(Number(rows[0]!.lopDaysExact)).toBe(0.5);
    expect(rows[0]!.lopDays).toBe(0);
    const got = await runWithTenant(TENANT, () => lopRepo.getLopForMonth(TENANT, EMP, MONTH));
    expect(got).toEqual({ hasLedger: true, days: 0.5 });
  });

  it("whole + half accumulate exactly (2 + 0.5 + 0.5 = 3) and batched reads agree", async () => {
    await scoped((tx) => lopRepo.upsertLopDays(tx, TENANT, EMP, MONTH, "leave", 2));
    await scoped((tx) => lopRepo.upsertLopDays(tx, TENANT, EMP, MONTH, "leave", 0.5));
    await scoped((tx) => lopRepo.upsertLopDays(tx, TENANT, EMP, MONTH, "leave", 0.5));
    const rows = await scoped((tx) => tx.select().from(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT)));
    expect(Number(rows[0]!.lopDaysExact)).toBe(3);
    expect(rows[0]!.lopDays).toBe(3);
    const batched = await scoped((tx) => lopRepo.getLopForMonthsTx(tx, TENANT, [EMP], MONTH));
    expect(batched.get(EMP)).toEqual({ hasLedger: true, days: 3 });
    expect(await runWithTenant(TENANT, () => lopRepo.sumLopDays(TENANT, EMP, MONTH))).toBe(3);
  });
});
