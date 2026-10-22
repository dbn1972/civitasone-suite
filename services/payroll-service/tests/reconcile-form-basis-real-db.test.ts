/**
 * GAP-PAYROLL-STATUTORY-CHALLANS-04 / -03 (real Postgres, FORCE RLS, no mocks): the TDS
 * reconciliation behind the challans page is computed on the basis of the SELECTED FORM.
 *
 *   24Q  = SALARY TDS (statutory.payroll_tds, finalised runs)   vs 24Q challans
 *   26Q  = NON-SALARY TDS (statutory.payroll_tds_nonsalary)      vs 26Q challans
 *
 * Before the fix, GET /v1/payroll/statutory/reconcile?formType=26Q filtered only the DEPOSITED side
 * by form and compared 26Q challans with SALARY TDS, so the Reconciliation Status tile and the
 * "filing blocked" banner were computed from the wrong figures. This drives the real route against
 * a real, migrated Postgres, with exact paise values.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance (see vitest.config.ts REL-035).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

// vitest.config.ts sets JWT_SECRET for every suite.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

// Three months of FY 2026-27 Q3 (Oct, Nov, Dec), each isolating one scenario.
const P1 = "2026-10"; // 26Q: non-salary X == 26Q challan X (MATCHED). Salary Y present, no 24Q challan.
const P2 = "2026-11"; // 24Q: salary == 24Q challan (MATCHED). Non-salary present, no 26Q challan.
const P3 = "2026-12"; // 26Q: non-salary 400000 vs 26Q challan 100000 (SHORTFALL). No salary at all.

type TxRunner = { execute: (x: unknown) => Promise<unknown> };

function auth(roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "reconcile-form-basis" }, SECRET)}` };
}

let app: Awaited<ReturnType<typeof buildApp>>;

const scoped = <T,>(tenant: string, fn: (tx: TxRunner) => Promise<T>): Promise<T> =>
  withTenantScope(db as never, tenant, fn as never) as Promise<T>;

/** Approved salary run + its payroll_tds row (the 24Q "deducted" basis). */
async function seedSalaryTds(tenant: string, period: string, tdsMinor: string) {
  const runId = randomUUID();
  await scoped(tenant, async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
      VALUES (${runId}::uuid, ${tenant}::uuid, ${"RFB/" + runId.slice(0, 8)}, ${period}, ${randomUUID()}::uuid, 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`
      INSERT INTO statutory.payroll_tds (tenant_id, slip_id, employee_id, run_id, tds_minor, period, created_by, updated_by)
      VALUES (${tenant}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${runId}::uuid, ${tdsMinor}::bigint, ${period}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
}

/** A non-salary TDS deduction (the 26Q "deducted" basis). */
async function seedNonSalaryTds(tenant: string, period: string, section: string, tdsMinor: string) {
  await scoped(tenant, async (tx) => {
    await tx.execute(sql`
      INSERT INTO statutory.payroll_tds_nonsalary
        (tenant_id, period, deductee_ref, deductee_name, deductee_pan, section, paid_amount_minor, tds_amount_minor, created_by)
      VALUES (${tenant}::uuid, ${period}, ${"VENDOR-" + randomUUID().slice(0, 8)}, 'Contractor', '', ${section},
              ${(BigInt(tdsMinor) * 10n).toString()}::bigint, ${tdsMinor}::bigint, ${ACTOR}::uuid)`);
  });
}

/** A deposited challan for the given form. */
async function seedChallan(tenant: string, period: string, formType: "24Q" | "26Q", serial: string, tdsMinor: string) {
  await scoped(tenant, async (tx) => {
    await tx.execute(sql`
      INSERT INTO statutory.payroll_tds_challan
        (tenant_id, period, section, form_type, bsr_code, challan_serial, deposit_date, cin,
         tds_amount_minor, total_amount_minor, created_by)
      VALUES (${tenant}::uuid, ${period}, ${formType === "26Q" ? "194" : "192"}, ${formType}, '0510308', ${serial}, '2027-01-05',
              ${"0510308" + "05012027" + serial.padStart(5, "0") + formType + period}, ${tdsMinor}::bigint, ${tdsMinor}::bigint, ${ACTOR}::uuid)`);
  });
}

beforeAll(async () => {
  app = await buildApp();

  // P1: non-salary X = 1000000 + 234500 = 1234500 paise, one 26Q challan of exactly X.
  //     Salary Y = 9999900 (approved run) that must NOT influence the 26Q result; no 24Q challan.
  await seedNonSalaryTds(TENANT, P1, "194C", "1000000");
  await seedNonSalaryTds(TENANT, P1, "194J", "234500");
  await seedChallan(TENANT, P1, "26Q", "201", "1234500");
  await seedSalaryTds(TENANT, P1, "9999900");

  // P2: salary 500000 deposited by an equal 24Q challan. Non-salary 300000 with NO 26Q challan.
  await seedSalaryTds(TENANT, P2, "500000");
  await seedChallan(TENANT, P2, "24Q", "202", "500000");
  await seedNonSalaryTds(TENANT, P2, "194C", "300000");

  // P3: non-salary 400000, 26Q challan only 100000 (shortfall 300000). No salary run.
  await seedNonSalaryTds(TENANT, P3, "194I", "400000");
  await seedChallan(TENANT, P3, "26Q", "203", "100000");

  // Another tenant, same period: must never leak into TENANT's figures.
  await seedNonSalaryTds(OTHER_TENANT, P1, "194C", "777777");
  await seedChallan(OTHER_TENANT, P1, "26Q", "301", "777000");
  await seedSalaryTds(OTHER_TENANT, P1, "123456");
});

afterAll(async () => {
  await app?.close();
  await sqlClient.end();
});

type Per = {
  period: string; formType: string; tdsDeductedMinor: string; tdsDepositedMinor: string;
  varianceMinor: string; matched: boolean; challanCount: number; status: string;
};
type ReconBody = {
  formType: string; period?: string; fy?: string; quarter?: string; perPeriod: Per[];
  totalDeductedMinor: string; totalDepositedMinor: string; varianceMinor: string;
  matched: boolean; filingBlocked: boolean; note: string;
};

async function reconcile(query: string, roles = ["payroll_admin"], tenant = TENANT) {
  return app.inject({ method: "GET", url: `/v1/payroll/statutory/reconcile?${query}`, headers: auth(roles, tenant) });
}

describe("GET /v1/payroll/statutory/reconcile -- the deducted basis follows the selected form (real DB)", () => {
  it("26Q: non-salary X vs 26Q challan X is MATCHED, and the salary TDS row Y does not influence it", async () => {
    const res = await reconcile(`period=${P1}&formType=26Q`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as ReconBody;
    expect(body.formType).toBe("26Q");
    expect(body.perPeriod).toHaveLength(1);
    expect(body.perPeriod[0]).toMatchObject({
      period: P1, formType: "26Q",
      tdsDeductedMinor: "1234500", // payroll_tds_nonsalary 1000000 + 234500, NOT the salary 9999900
      tdsDepositedMinor: "1234500",
      varianceMinor: "0", matched: true, challanCount: 1, status: "matched",
    });
    expect(body.totalDeductedMinor).toBe("1234500");
    expect(body.totalDepositedMinor).toBe("1234500");
    expect(body.varianceMinor).toBe("0");
    expect(body.matched).toBe(true);
    expect(body.filingBlocked).toBe(false);
    expect(body.note).toBe("TDS deducted equals deposited; 26Q may be filed.");
  });

  it("24Q: salary Y vs 24Q challans is unaffected by the 26Q challan and the non-salary rows", async () => {
    // P1 has salary 9999900, a 26Q challan of 1234500 and NO 24Q challan: the 26Q challan must not count.
    const res = await reconcile(`period=${P1}&formType=24Q`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as ReconBody;
    expect(body.formType).toBe("24Q");
    expect(body.perPeriod[0]).toMatchObject({
      period: P1, formType: "24Q",
      tdsDeductedMinor: "9999900", // salary TDS only, never the non-salary 1234500
      tdsDepositedMinor: "0",      // the 26Q challan must not be counted as a 24Q deposit
      varianceMinor: "-9999900", matched: false, challanCount: 0, status: "no_challan",
    });
    expect(body.matched).toBe(false);
    expect(body.filingBlocked).toBe(true);
    expect(body.note).toBe("TDS deducted does NOT match deposited challans; resolve before filing 24Q.");
  });

  it("omitting formType keeps the 24Q basis (default)", async () => {
    const withDefault = (await reconcile(`period=${P2}`)).json() as ReconBody;
    const explicit = (await reconcile(`period=${P2}&formType=24Q`)).json() as ReconBody;
    expect(withDefault.formType).toBe("24Q");
    expect(withDefault.perPeriod[0]).toMatchObject({ tdsDeductedMinor: "500000", tdsDepositedMinor: "500000", status: "matched", matched: true });
    expect(withDefault).toEqual(explicit);
  });

  it("24Q is MATCHED when salary == 24Q challan, even though a non-salary deduction sits unreconciled in 26Q", async () => {
    const body = (await reconcile(`period=${P2}&formType=24Q`)).json() as ReconBody;
    expect(body.perPeriod[0]).toMatchObject({ tdsDeductedMinor: "500000", tdsDepositedMinor: "500000", varianceMinor: "0", status: "matched", matched: true });
    expect(body.filingBlocked).toBe(false);
    expect(body.note).toBe("TDS deducted equals deposited; 24Q may be filed.");
  });

  it("26Q with non-salary TDS but no 26Q challan is no_challan and blocks 26Q filing (salary challan does not count)", async () => {
    // P2 has a 24Q challan of 500000; it must not satisfy the 26Q obligation of 300000.
    const body = (await reconcile(`period=${P2}&formType=26Q`)).json() as ReconBody;
    expect(body.perPeriod[0]).toMatchObject({
      tdsDeductedMinor: "300000", tdsDepositedMinor: "0", varianceMinor: "-300000",
      matched: false, challanCount: 0, status: "no_challan",
    });
    expect(body.matched).toBe(false);
    expect(body.filingBlocked).toBe(true);
    expect(body.note).toBe("TDS deducted does NOT match deposited challans; resolve before filing 26Q.");
  });

  it("26Q shortfall is exact in paise and the blocked note names 26Q, never 24Q", async () => {
    const body = (await reconcile(`period=${P3}&formType=26Q`)).json() as ReconBody;
    expect(body.perPeriod[0]).toMatchObject({
      tdsDeductedMinor: "400000", tdsDepositedMinor: "100000", varianceMinor: "-300000",
      matched: false, challanCount: 1, status: "shortfall",
    });
    expect(body.filingBlocked).toBe(true);
    expect(body.note).toContain("26Q");
    expect(body.note).not.toContain("24Q");
  });

  it("a 26Q challan never influences the 24Q result for the same period", async () => {
    // P3 has no salary and only a 26Q challan of 100000: 24Q is reconciled by definition (0 == 0).
    const body = (await reconcile(`period=${P3}&formType=24Q`)).json() as ReconBody;
    expect(body.perPeriod[0]).toMatchObject({
      tdsDeductedMinor: "0", tdsDepositedMinor: "0", varianceMinor: "0", challanCount: 0, status: "matched", matched: true,
    });
    expect(body.filingBlocked).toBe(false);
  });

  it("a quarter (fy+quarter) reconciles each month on the form's own basis and sums exactly", async () => {
    const q26 = (await reconcile("fy=2026-27&quarter=Q3&formType=26Q")).json() as ReconBody;
    expect(q26.perPeriod.map((r) => [r.period, r.status, r.tdsDeductedMinor, r.tdsDepositedMinor])).toEqual([
      [P1, "matched", "1234500", "1234500"],
      [P2, "no_challan", "300000", "0"],
      [P3, "shortfall", "400000", "100000"],
    ]);
    expect(q26.totalDeductedMinor).toBe("1934500");   // 1234500 + 300000 + 400000
    expect(q26.totalDepositedMinor).toBe("1334500");  // 1234500 + 0 + 100000
    expect(q26.varianceMinor).toBe("-600000");
    expect(q26.matched).toBe(false);
    expect(q26.filingBlocked).toBe(true);

    const q24 = (await reconcile("fy=2026-27&quarter=Q3&formType=24Q")).json() as ReconBody;
    expect(q24.perPeriod.map((r) => [r.period, r.status, r.tdsDeductedMinor, r.tdsDepositedMinor])).toEqual([
      [P1, "no_challan", "9999900", "0"],
      [P2, "matched", "500000", "500000"],
      [P3, "matched", "0", "0"],
    ]);
    expect(q24.totalDeductedMinor).toBe("10499900"); // 9999900 + 500000 + 0
    expect(q24.totalDepositedMinor).toBe("500000");
    expect(q24.varianceMinor).toBe("-9999900");
  });

  it("an unrecognised formType falls back to the 24Q basis, never a mixed one", async () => {
    const body = (await reconcile(`period=${P1}&formType=27Q`)).json() as ReconBody;
    expect(body.formType).toBe("24Q");
    expect(body.perPeriod[0]).toMatchObject({ formType: "24Q", tdsDeductedMinor: "9999900", tdsDepositedMinor: "0" });
  });

  it("is tenant-scoped: another tenant's non-salary, salary and 26Q rows never reach this tenant's figures", async () => {
    const mine = (await reconcile(`period=${P1}&formType=26Q`)).json() as ReconBody;
    expect(mine.perPeriod[0]).toMatchObject({ tdsDeductedMinor: "1234500", tdsDepositedMinor: "1234500" });

    const other = (await reconcile(`period=${P1}&formType=26Q`, ["payroll_admin"], OTHER_TENANT)).json() as ReconBody;
    expect(other.perPeriod[0]).toMatchObject({
      tdsDeductedMinor: "777777", tdsDepositedMinor: "777000", varianceMinor: "-777", status: "shortfall", matched: false,
    });
    const other24 = (await reconcile(`period=${P1}&formType=24Q`, ["payroll_admin"], OTHER_TENANT)).json() as ReconBody;
    expect(other24.perPeriod[0]).toMatchObject({ tdsDeductedMinor: "123456", tdsDepositedMinor: "0" });
  });

  it("is role-gated: an employee gets 403 for both forms", async () => {
    expect((await reconcile(`period=${P1}&formType=26Q`, ["employee"])).statusCode).toBe(403);
    expect((await reconcile(`period=${P1}&formType=24Q`, ["employee"])).statusCode).toBe(403);
  });
});
