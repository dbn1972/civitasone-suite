/**
 * processPensionRun -- Sec 192 TDS true-up across a DR change (MEDIUM,
 * payroll-calc audit regression).
 *
 * Before this fix, processPensionRun recomputed monthly TDS from scratch
 * every run via plain truncating bigint division
 * (`(annualTax / 100n / 12n) * 100n`, despite a comment claiming it was
 * "rupee-rounded") -- with no memory of what had already been withheld this
 * FY. When DR (Dearness Relief) rose mid-year, months BEFORE the rise were
 * under-withheld, and nothing ever corrected it: each subsequent month just
 * re-truncated its own fresh (now higher) annualTax/12.
 *
 * The fix reuses tax/engine.ts's trueUpTdsMinor (round-half-up spread, full
 * residual in the final month -- already proven correct and already used by
 * the salary path via domain.ts computeSlip), fed by a REAL YTD-withheld
 * figure pulled from statutory.payroll_tds via resolveTdsYtdMinorsTx (also
 * pre-existing, also reused as-is from the salary path). This test exercises
 * that exact sequence -- resolveTdsYtdMinorsTx(tx, ...) then
 * trueUpTdsMinor(...) -- the same way, in the same order, with the same
 * tx-scoping, that processPensionRun's transaction body now does.
 *
 * NOT exercised here: driving processPensionRun end-to-end through the real
 * queue consumer. processPensionRun's OWN pensioner-list fetch and DA/DR
 * -rate resolution (resolveDaRateBps) run as bare db.execute() calls BEFORE
 * its db.transaction() opens -- and packages/db/src/wrap-tenant-db.ts's
 * wrapWithTenantGuc only auto-sets the app.tenant_id GUC for
 * db.transaction(), never for a bare db.execute(). Confirmed directly
 * against Postgres: the exact same SELECT against
 * payroll.payroll_pensioners returns 0 rows without the GUC set and 1 row
 * with it, even with the message's tenant context active via
 * tenantScoped/withTenantConsumer (which only reaches db.transaction()
 * callers). That pre-existing, unrelated gap silently starves
 * processPensionRun (and processPayrollRun's own equivalent pre-transaction
 * DA-rate lookup) of any rows in the "pool" tenant tier, independent of and
 * pre-dating this branch -- flagged separately, out of scope for this fix.
 * This test instead targets exactly the code this fix touches: the true-up
 * wiring INSIDE the transaction, which is correctly tx-scoped and does not
 * hit that gap.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { resolveTdsYtdMinorsTx } from "../src/modules/payroll/consumer.js";
import { computePension } from "../src/modules/payroll/domain.js";
import { annualTaxFromTaxableMinor, trueUpTdsMinor, stdDeduction } from "../src/modules/tax/engine.js";

const ACTOR = "91000000-0000-4021-8000-0000000000b2";

afterAll(async () => { await sqlClient.end(); });

describe("processPensionRun -- Sec 192 TDS true-up across a DR change (MEDIUM, payroll-calc audit)", () => {
  it("second month's TDS trues up against the first month's REAL withheld amount, not a fresh /12 split", async () => {
    const tenant = randomUUID();
    const pensionerId = randomUUID();
    const basicPensionMinor = 15_000_000n; // ₹1,50,000/month basic pension
    const dob = "1955-01-01"; // well under 80 -> additionalPensionPct = 0, keeps the fixture simple
    const fyStart = 2026;

    // Re-derive each month's annual tax the SAME way processPensionRun does
    // (computePension for gross, same std deduction, same
    // annualTaxFromTaxableMinor call) -- this test is not re-verifying that
    // pure math (covered by pension-computation-deep.test.ts /
    // tax-engine-coverage.test.ts elsewhere); it verifies the true-up WIRING.
    function annualTaxFor(drRateBps: bigint, month: string): bigint {
      const preview = computePension({ basicPensionMinor, drRateBps, dateOfBirth: dob, month });
      const annualGross = preview.grossMinor * 12n;
      const stdDed = BigInt(stdDeduction("new", fyStart, tenant)) * 100n;
      let annualTaxable = annualGross - stdDed;
      if (annualTaxable < 0n) annualTaxable = 0n;
      return annualTaxFromTaxableMinor(annualTaxable, "new", fyStart, tenant);
    }

    // ── Month 1 (April, DR 40%): what a correctly-fixed run 1 would have
    // withheld and persisted -- YTD=0, 12 months remaining. ──
    const annualTax1 = annualTaxFor(4000n, "2026-04");
    const tds1 = trueUpTdsMinor(annualTax1, 0n, 12);
    expect(tds1).toBeGreaterThan(0n); // fixture sanity

    // Persist run 1 + its TDS row exactly as processPensionRun's transaction
    // body does (repo.insertRun + statutoryRepo.insertTds), status
    // 'approved' so resolveTdsYtdMinorsTx's approved/disbursed-only filter
    // (same M3 guard the salary path uses) picks it up.
    const run1 = randomUUID();
    const slip1 = randomUUID();
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_runs
          (id, tenant_id, run_no, month, structure_id, status, run_type, created_by, updated_by)
        VALUES (${run1}::uuid, ${tenant}::uuid, 'PENSION-RUN-1', '2026-04', ${randomUUID()}::uuid, 'approved', 'pensioner', ${ACTOR}::uuid, ${ACTOR}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO statutory.payroll_tds
          (tenant_id, slip_id, employee_id, run_id, annual_basic_minor, taxable_minor, tds_minor, period, created_by, updated_by)
        VALUES (${tenant}::uuid, ${slip1}::uuid, ${pensionerId}::uuid, ${run1}::uuid, ${(basicPensionMinor * 12n).toString()}::bigint, 0, ${tds1.toString()}::bigint, '2026-04', ${ACTOR}::uuid, ${ACTOR}::uuid)
      `);
    }));

    // ── Month 2 (May, DR hikes to 60%): the exact sequence processPensionRun's
    // transaction body runs -- resolveTdsYtdMinorsTx(tx, ...) then
    // trueUpTdsMinor(...), fed by the REAL DB-round-tripped YTD. ──
    const annualTax2 = annualTaxFor(6000n, "2026-05");
    expect(annualTax2).toBeGreaterThan(annualTax1); // fixture sanity: DR hike must move the needle

    const { tdsYtdMinor, tds2 } = await runWithTenant(tenant, () => db.transaction(async (tx) => {
      const tdsYtdByPensioner = await resolveTdsYtdMinorsTx(tx as unknown as typeof db, tenant, [pensionerId], fyStart, "2026-05");
      const ytd = tdsYtdByPensioner.get(pensionerId) ?? 0n;
      return { tdsYtdMinor: ytd, tds2: trueUpTdsMinor(annualTax2, ytd, 11) };
    }));

    // resolveTdsYtdMinorsTx correctly round-tripped run 1's REAL withheld
    // amount through statutory.payroll_tds (not 0, not annualTax1 itself).
    expect(tdsYtdMinor).toBe(tds1);

    // The regression this test guards: if the true-up were dropped
    // (reverting to a fresh naive /12 split every month regardless of
    // history), month 2 would instead equal trueUpTdsMinor(annualTax2, 0n,
    // 11) -- a DIFFERENT value given the size of this DR hike.
    const naiveTds2WithoutTrueUp = trueUpTdsMinor(annualTax2, 0n, 11);
    expect(naiveTds2WithoutTrueUp, "fixture sanity: hike must be large enough to distinguish true-up from naive").not.toBe(tds2);
    expect(tds2).not.toBe(naiveTds2WithoutTrueUp);
    expect(tds2).toBe(trueUpTdsMinor(annualTax2, tds1, 11));
  });
});
