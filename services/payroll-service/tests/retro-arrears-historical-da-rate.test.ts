/**
 * generateRetroArrears -- historical DA rate per period (HIGH, payroll-calc
 * audit regression).
 *
 * Before this fix, generateRetroArrears resolved the DA rate (and the HRA
 * slab tier it drives, hraSlabPct) ONCE for the RUN month and reused it,
 * unchanged, for every historical period between a salary revision's
 * effective month and the run month. DA/DR changes roughly twice a year and
 * has only ever risen historically, so a revision whose retro window spans a
 * DA rate change had its PRE-change months priced at the (higher) run-month
 * rate too -- a systematic overpayment for every month before the DA hike.
 *
 * The fix resolves each period's OWN historical DA rate inside the loop
 * (resolveDaRateBps(tx, tenantId, period), memoized per period via
 * daRateCache) instead of taking one rate in from the caller.
 *
 * This test seeds a DA rate change effective mid-way through a 3-month retro
 * window (Feb-Apr, run month May) and asserts Feb/Mar price at the OLD
 * (pre-hike) rate while Apr prices at the NEW rate -- and explicitly that
 * Feb/Mar do NOT match what pricing everything at the run month's rate would
 * have produced.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { generateRetroArrears } from "../src/modules/payroll/consumer.js";

afterAll(async () => { await sqlClient.end(); });

describe("generateRetroArrears -- historical DA rate per period (HIGH, payroll-calc audit)", () => {
  it("prices each retro-arrears period at ITS OWN historical DA rate, not the run month's rate", async () => {
    const tenant = randomUUID();
    const employeeId = randomUUID();
    const actorId = randomUUID();

    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      // DA rate history: 40% through Mar 2026, hikes to 50% from Apr 2026.
      await tx.execute(sql`
        INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps)
        VALUES (${tenant}::uuid, '2026-01-01'::date, 4000), (${tenant}::uuid, '2026-04-01'::date, 5000)
      `);
      // Salary revision effective mid-Feb: basic 50,000 -> 60,000 (delta
      // 10,000 = 1,000,000 paise). Retro window (effMonth..runMonth-1) will
      // be Feb, Mar, Apr once processed for run month 2026-05.
      await tx.execute(sql`
        INSERT INTO payroll.payroll_salary_revisions
          (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor)
        VALUES (${tenant}::uuid, ${employeeId}::uuid, '2026-02-15'::date, 5000000, 6000000, 8000000, 9000000)
      `);
    }));

    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await generateRetroArrears(tx as unknown as typeof db, tenant, employeeId, "2026-05", "X", actorId);
    }));

    const rows = await runWithTenant(tenant, () => db.transaction(async (tx) => (await tx.execute(sql`
      SELECT from_period, component_code, difference_minor
      FROM payroll.payroll_arrears
      WHERE tenant_id = ${tenant}::uuid AND employee_id = ${employeeId}::uuid
      ORDER BY from_period ASC
    `)) as unknown as Array<{ from_period: string; component_code: string; difference_minor: string }>));

    expect(rows.map((r) => r.from_period)).toEqual(["2026-02", "2026-03", "2026-04"]);
    for (const r of rows) expect(r.component_code).toBe("ARREAR"); // positive delta, not a recovery

    // Feb & Mar (pre-hike, DA still 40%): basicDelta 1,000,000
    //   + daDelta (basicDelta*4000/10000, roundRupee) 400,000
    //   + hraDelta (basicDelta*hraSlabPct("X",4000bps)=27 /100, roundRupee) 270,000
    //   = 1,670,000.
    expect(BigInt(rows[0]!.difference_minor), "Feb (pre-DA-hike rate)").toBe(1_670_000n);
    expect(BigInt(rows[1]!.difference_minor), "Mar (pre-DA-hike rate)").toBe(1_670_000n);
    // Apr (post-hike, DA now 50%): daDelta 500,000 + hraDelta
    //   (hraSlabPct("X",5000bps)=30) 300,000 = 1,800,000.
    expect(BigInt(rows[2]!.difference_minor), "Apr (post-DA-hike rate)").toBe(1_800_000n);

    // The regression this test guards: pricing every period at the RUN
    // MONTH's rate (50%, as the pre-fix code did) would have produced
    // 1,800,000 for Feb and Mar too -- a ₹1,300/month overpayment before the
    // DA actually changed. Assert those two periods do NOT carry that value.
    expect(BigInt(rows[0]!.difference_minor)).not.toBe(1_800_000n);
    expect(BigInt(rows[1]!.difference_minor)).not.toBe(1_800_000n);
  });
});
