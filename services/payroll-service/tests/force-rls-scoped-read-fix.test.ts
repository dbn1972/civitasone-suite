/**
 * FORCE-RLS scoped-read fix -- regression + live verification.
 *
 * Three FORCE RLS tables were read via a bare `db.execute()` OUTSIDE any
 * `db.transaction()`/`scopedRead()`. Under the NOBYPASSRLS `payroll_svc` role
 * that means no `app.tenant_id` GUC is ever set for these reads, so the
 * fail-closed RLS policy silently returns ZERO rows even when matching data
 * genuinely exists -- and the caller treats "empty" as a legitimate business
 * outcome:
 *   1. resolveProtectedNetFloorMinor (payroll.payroll_settings)  -- floor
 *      always resolved to 0 and was never applied.
 *   2. resolveDdoDepartments (payroll.payroll_ddo_departments) -- any
 *      DDO-scoped run paid nobody.
 *   3. processPensionRun's own pensioner query (payroll.payroll_pensioners)
 *      -- every pensioner payroll run paid nobody.
 *
 * The sweep for the same pattern across payroll-service/src also found:
 *   4. resolvePtSlabs(db, ...) -- call-site only; the callee already takes
 *      `tx: typeof db` correctly (payroll.payroll_professional_tax).
 *   5. resolveRunStatutoryConfig(db, ...) -- call-site only, same shape
 *      (statutory.statutory_config); the silent fallback here is
 *      DEFAULT_STATUTORY_CONFIG instead of the tenant's real override.
 *   6-8. repo.ts's insertArrear/insertBonus/insertReimbursement -- bare
 *      db.execute() INSERTs into FORCE RLS tables, outside any transaction.
 *      Unlike 1-5 this fails LOUD (an INSERT with no WITH CHECK-satisfying
 *      GUC is rejected by Postgres, not silently accepted) -- confirmed
 *      directly against Postgres before writing this test. These three are
 *      currently unreferenced by any route (dead code), so the bug is real
 *      but not live; fixed here anyway since the fix is the identical
 *      one-line shape and leaves no landmine for whoever wires them up next.
 *
 * Scenarios 1-3 drive the REAL HTTP route -> command -> consumer chain
 * end-to-end (buildApp() + a single process's own shared `queue` singleton,
 * with registerPayrollConsumers registered on that SAME singleton and
 * wrapped for tenant-context exactly as worker.ts does) -- required because
 * QUEUE_DRIVER=memory gives each process its own in-memory queue, and the
 * real deployed `payroll` / `payroll-worker` PM2 processes are separate
 * processes that would never see each other's messages otherwise.
 *
 * Every assertion below encodes the CORRECT, post-fix behaviour. Run against
 * unmodified consumer.ts/repo.ts, this file fails with the exact broken
 * numbers (captured in the PR description); after the fix, it passes.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";

import { buildApp } from "../src/app.js";
import { db, sqlClient, scopedRead } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import {
  registerPayrollConsumers,
  resolvePtSlabs,
  resolveRunStatutoryConfig,
} from "../src/modules/payroll/consumer.js";
import { insertArrear, insertBonus, insertReimbursement } from "../src/modules/payroll/repo.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ROLES = ["payroll_admin", "super_admin", "hr_admin", "payroll_officer"];
const ACTOR = randomUUID();

function token(tenantId: string) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ROLES, sid: "sess-force-rls-fix" }, SECRET, 3600);
}

/** DA rate = 0bps so daMinor is 0 everywhere below and math stays simple.
 * Required: processPayrollRun/processPensionRun throw DA_RATE_NOT_CONFIGURED
 * (an intentional, unrelated loud-failure fix) if no row exists at all. */
async function seedDaRateZero(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps)
        VALUES (${tenantId}::uuid, '2026-01-01', 0)
      `);
    }),
  );
}

async function waitWhileProcessing(tenantId: string, runId: string, maxMs = 6000): Promise<void> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    await new Promise((r) => setTimeout(r, 200));
    const rows = (await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.execute(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`)),
    )) as unknown as Array<{ status: string; last_error: string | null }>;
    if (rows[0]?.status === "failed") throw new Error(`run ${runId} failed: ${rows[0].last_error}`);
    if (Date.now() >= deadline) return;
  }
}

function parseComponents(raw: unknown): Array<{ code: string; amountMinor: number }> {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as Array<{ code: string; amountMinor: number }>;
}

let app: FastifyInstance;

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Bug 1 (resolveDdoDepartments) + Bug 2 (processPensionRun pensioners) + Bug 3 (resolveProtectedNetFloorMinor) -- live, end-to-end", () => {
  it("pensioner run: a real active pensioner exists but pre-fix the run pays nobody (FORCE RLS payroll.payroll_pensioners)", async () => {
    const tenant = randomUUID();
    const pensionerId = randomUUID();
    const month = "2026-04";
    await seedDaRateZero(tenant);

    const basicPensionMinor = 8_000_000n; // Rs 80,000/month -- own fixture value
    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_pensioners
            (id, tenant_id, ppo_no, full_name, date_of_birth, basic_pension_minor, status, tax_regime, created_by, updated_by)
          VALUES (${pensionerId}::uuid, ${tenant}::uuid, 'PPO-FIXVERIFY-01', 'Fixture Pensioner One', '1958-06-15', ${basicPensionMinor.toString()}, 'active', 'new', ${ACTOR}::uuid, ${ACTOR}::uuid)
        `);
      }),
    );

    // Independent, direct confirmation the row really exists -- proves any
    // "pays nobody" result below is the bug, not a seeding mistake.
    const direct = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_pensioners WHERE id = ${pensionerId}::uuid`)),
    )) as unknown as Array<{ n: number }>;
    expect(direct[0]?.n).toBe(1);

    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token(tenant)}`, "content-type": "application/json" },
      payload: { runNo: "PENSION-FIXVERIFY-01", month, runType: "pensioner" },
    });
    expect([201, 202]).toContain(res.statusCode);
    const runId: string = res.json().data?.id ?? res.json().id;
    await waitWhileProcessing(tenant, runId, 6000);

    const slips = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT employee_id, gross_minor FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid`)),
    )) as unknown as Array<{ employee_id: string; gross_minor: string }>;
    const runRow = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT total_gross_minor FROM payroll.payroll_runs WHERE id = ${runId}::uuid`)),
    )) as unknown as Array<{ total_gross_minor: string }>;

    console.log(
      `[pensioner scenario] employeeCount=${slips.length} grossMinor=${runRow[0]?.total_gross_minor} ` +
        `(real pensioner basic=${basicPensionMinor}, id=${pensionerId})`,
    );

    expect(slips).toHaveLength(1);
    expect(slips[0]?.employee_id).toBe(pensionerId);
    expect(BigInt(runRow[0]?.total_gross_minor ?? "0")).toBeGreaterThan(0n);
  });

  it("DDO-scoped run: real DDO+department mapping exists but pre-fix the run pays nobody, and post-fix pays only the mapped employee (FORCE RLS payroll.payroll_ddo_departments)", async () => {
    const tenant = randomUUID();
    const ddoCode = "DDO-FIXVERIFY-9";
    const deptMapped = randomUUID();
    const deptOther = randomUUID();
    const structureId = randomUUID();
    const empMapped = randomUUID();
    const empOther = randomUUID();
    const month = "2026-05";
    await seedDaRateZero(tenant);

    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by)
          VALUES (${structureId}::uuid, ${tenant}::uuid, 'DDO Fixture Structure', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)
        `);
        await tx.execute(sql`
          INSERT INTO payroll.payroll_ddos (tenant_id, ddo_code, name)
          VALUES (${tenant}::uuid, ${ddoCode}, 'Fixture DDO')
        `);
        await tx.execute(sql`
          INSERT INTO payroll.payroll_ddo_departments (tenant_id, department_id, ddo_code)
          VALUES (${tenant}::uuid, ${deptMapped}::uuid, ${ddoCode})
        `);
      }),
    );

    const direct = (await runWithTenant(tenant, () =>
      db.transaction((tx) =>
        tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_ddo_departments WHERE tenant_id=${tenant}::uuid AND ddo_code=${ddoCode}`),
      ),
    )) as unknown as Array<{ n: number }>;
    expect(direct[0]?.n).toBe(1);

    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month,
      employees: [
        {
          id: empMapped, employeeNo: "EMP-MAPPED-1", fullName: "Mapped Employee", basicMinor: "3000000",
          dateOfJoining: "2020-01-01", payStructureId: structureId, bankAccountNo: null, bankIfsc: null,
          pan: null, uan: null, cityClass: "Z", taxRegime: "new", departmentId: deptMapped, pensionScheme: "GPF",
        },
        {
          id: empOther, employeeNo: "EMP-OTHER-1", fullName: "Other-Dept Employee", basicMinor: "3000000",
          dateOfJoining: "2020-01-01", payStructureId: structureId, bankAccountNo: null, bankIfsc: null,
          pan: null, uan: null, cityClass: "Z", taxRegime: "new", departmentId: deptOther, pensionScheme: "GPF",
        },
      ],
      lopDays: {}, overtimeHours: {},
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token(tenant)}`, "content-type": "application/json" },
      payload: { runNo: "DDO-FIXVERIFY-01", month, structureId, ddoCode, runType: "regular" },
    });
    expect([201, 202]).toContain(res.statusCode);
    const runId: string = res.json().data?.id ?? res.json().id;
    await waitWhileProcessing(tenant, runId, 6000);

    const slips = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT employee_id FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid`)),
    )) as unknown as Array<{ employee_id: string }>;

    console.log(
      `[ddo scenario] slipCount=${slips.length} employeeIds=${JSON.stringify(slips.map((s) => s.employee_id))} ` +
        `(mapped=${empMapped} shouldBeExcluded=${empOther})`,
    );

    // Exactly the mapped-department employee is paid; the unmapped-department
    // employee is correctly excluded -- proves this is a real filter fix,
    // not "now pays everyone regardless of mapping".
    expect(slips).toHaveLength(1);
    expect(slips[0]?.employee_id).toBe(empMapped);
  });

  it("protected-net-floor: a real configured floor is silently ignored pre-fix (full recovery applied); post-fix net pay is capped at exactly the configured floor and the remainder carried forward (FORCE RLS payroll.payroll_settings)", async () => {
    const tenant = randomUUID();
    const structureId = randomUUID();
    const empId = randomUUID();
    const deptId = randomUUID();
    await seedDaRateZero(tenant);

    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by)
          VALUES (${structureId}::uuid, ${tenant}::uuid, 'Floor Fixture Structure', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)
        `);
      }),
    );

    const basicMinor = 5_000_000n; // Rs 50,000/month -- own fixture value
    const monthBaseline = "2026-06";
    const monthWithFloor = "2026-07"; // must differ from monthBaseline: a second
    // regular run for the same tenant+month+DDO is rejected (409
    // DUPLICATE_RUN_FOR_PERIOD) by the partial unique index -- these are two
    // deliberately separate runs, not a resubmission of the same period.
    const employeeInput = (forMonth: string) => ({
      month: forMonth,
      employees: [
        {
          id: empId, employeeNo: "EMP-FLOOR-1", fullName: "Floor Fixture Employee", basicMinor: basicMinor.toString(),
          dateOfJoining: "2015-01-01", payStructureId: structureId, bankAccountNo: null, bankIfsc: null,
          pan: null, uan: null, cityClass: "Z" as const, taxRegime: "new" as const, departmentId: deptId, pensionScheme: "GPF" as const,
        },
      ],
      lopDays: { [empId]: 35 }, // exceeds any month's day count -> clamped to a full-month LOP, guaranteed > any headroom
      overtimeHours: {},
    });
    vi.mocked(fetchPayrollInput).mockResolvedValue(employeeInput(monthBaseline));

    // ---- Baseline run: created BEFORE any floor is configured, so this run
    // establishes "gross" and the real (empirically observed, not
    // hand-guessed) non-recovery deduction total -- unaffected by this fix,
    // since the fix only changes whether a CONFIGURED floor is read, and no
    // floor is configured yet at this point in either pre-fix or post-fix code. ----
    const resBaseline = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token(tenant)}`, "content-type": "application/json" },
      payload: { runNo: "FLOOR-FIXVERIFY-BASELINE", month: monthBaseline, structureId, runType: "regular" },
    });
    expect([201, 202]).toContain(resBaseline.statusCode);
    const runIdBaseline: string = resBaseline.json().data?.id ?? resBaseline.json().id;
    await waitWhileProcessing(tenant, runIdBaseline, 6000);

    const slipBaselineRows = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT gross_minor, net_pay_minor, components FROM payroll.payroll_slips WHERE run_id = ${runIdBaseline}::uuid`)),
    )) as unknown as Array<{ gross_minor: string; net_pay_minor: string; components: unknown }>;
    expect(slipBaselineRows).toHaveLength(1);
    const grossMinor = BigInt(slipBaselineRows[0]!.gross_minor);
    const netBaseline = BigInt(slipBaselineRows[0]!.net_pay_minor);
    const lopBaseline = BigInt(parseComponents(slipBaselineRows[0]!.components).find((c) => c.code === "LOP")?.amountMinor ?? 0);
    // domain.ts computeSlip: netRaw = gross - nonRecovery - recoveryApplied.
    // Derived from the baseline run's own real output, not guessed.
    const nonRecovery = grossMinor - lopBaseline - netBaseline;

    // ---- Configure a REAL floor via the actual HTTP settings endpoint,
    // confirm persistence via GET (not a direct DB peek), exactly as a real
    // operator would. ----
    const floorMinor = 1_000_000n; // Rs 10,000/month -- own fixture value, comfortably < gross - nonRecovery
    const putRes = await app.inject({
      method: "PUT",
      url: "/v1/payroll/settings",
      headers: { authorization: `Bearer ${token(tenant)}`, "content-type": "application/json" },
      payload: { protectedNetFloorMinor: Number(floorMinor) },
    });
    expect([200, 202]).toContain(putRes.statusCode);

    let persistedFloor: number | undefined;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const getRes = await app.inject({ method: "GET", url: "/v1/payroll/settings", headers: { authorization: `Bearer ${token(tenant)}` } });
      expect(getRes.statusCode).toBe(200);
      persistedFloor = getRes.json().protectedNetFloorMinor;
      if (persistedFloor === Number(floorMinor)) break;
    }
    expect(persistedFloor).toBe(Number(floorMinor));

    // Hand-computed BEFORE running the floor-scoped payroll, from the
    // documented recovery-cap formula (domain.ts computeSlip) plus the
    // empirically observed baseline above: since the requested LOP recovery
    // (a full month's basic) vastly exceeds gross - nonRecovery - floor,
    // recovery is capped at exactly that headroom, so net pay must land at
    // EXACTLY the configured floor, to the paisa.
    const expectedNet = floorMinor;
    const expectedLopApplied = grossMinor - nonRecovery - floorMinor;
    const expectedCarryForward = lopBaseline - expectedLopApplied;

    vi.mocked(fetchPayrollInput).mockResolvedValue(employeeInput(monthWithFloor));
    const resFloor = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token(tenant)}`, "content-type": "application/json" },
      payload: { runNo: "FLOOR-FIXVERIFY-WITHFLOOR", month: monthWithFloor, structureId, runType: "regular" },
    });
    expect([201, 202]).toContain(resFloor.statusCode);
    const runIdFloor: string = resFloor.json().data?.id ?? resFloor.json().id;
    await waitWhileProcessing(tenant, runIdFloor, 6000);

    const slipFloorRows = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT net_pay_minor, components FROM payroll.payroll_slips WHERE run_id = ${runIdFloor}::uuid`)),
    )) as unknown as Array<{ net_pay_minor: string; components: unknown }>;
    expect(slipFloorRows).toHaveLength(1);
    const netWithFloor = BigInt(slipFloorRows[0]!.net_pay_minor);
    const lopWithFloor = BigInt(parseComponents(slipFloorRows[0]!.components).find((c) => c.code === "LOP")?.amountMinor ?? 0);
    const carryForward = lopBaseline - lopWithFloor;

    console.log(
      `[floor scenario] gross=${grossMinor} nonRecovery(derived)=${nonRecovery} lopRequested=${lopBaseline} | ` +
        `baseline(no-floor-configured-yet) net=${netBaseline} | configuredFloor=${floorMinor} | ` +
        `withFloor net=${netWithFloor} lopApplied=${lopWithFloor} carryForward=${carryForward} | ` +
        `expectedNet=${expectedNet} expectedLopApplied=${expectedLopApplied} expectedCarryForward=${expectedCarryForward}`,
    );

    expect(netWithFloor).toBe(expectedNet);
    expect(lopWithFloor).toBe(expectedLopApplied);
    expect(carryForward).toBe(expectedCarryForward);
  });
});

describe("Sweep extras: call-site-only instances (callee already takes tx: typeof db correctly)", () => {
  it("resolvePtSlabs: bare db is RLS-blind to a real PT slab row; scopedRead sees it (FORCE RLS payroll.payroll_professional_tax)", async () => {
    const tenant = randomUUID();
    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, is_active)
          VALUES (${tenant}::uuid, 'KA', 0, 999999999999, 20000, true)
        `);
      }),
    );

    // Bare `db` (the pre-fix call-site shape): RLS-blind, silently empty
    // despite a real slab row existing for this exact tenant+state.
    const viaBareDb = await resolvePtSlabs(db, tenant, "KA");
    console.log(`[resolvePtSlabs sweep] bare-db result length=${viaBareDb.length} (a real slab row exists for this tenant)`);
    expect(viaBareDb).toHaveLength(0);

    // scopedRead, wrapped in runWithTenant exactly as the real caller
    // (processPayrollRun, itself always invoked from inside the consumer's
    // own runWithTenant(msg.tenantId, ...) wrapping -- see this file's
    // beforeAll) provides tenant context for scopedRead's db.transaction to
    // read via AsyncLocalStorage and set the GUC from.
    const viaScoped = await runWithTenant(tenant, () => scopedRead((tx) => resolvePtSlabs(tx, tenant, "KA")));
    expect(viaScoped).toHaveLength(1);
    expect(viaScoped[0]?.amount).toBe(20000n);
  });

  it("resolveRunStatutoryConfig: bare db is RLS-blind to a tenant's own statutory-config override; scopedRead sees it (FORCE RLS statutory.statutory_config)", async () => {
    const tenant = randomUUID();
    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO statutory.statutory_config
            (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
             esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor, sec80ccd1b_cap_minor, created_by)
          VALUES (${tenant}::uuid, '2026-01-01', 10, 1500000, 833, 125000, 2100000, 75, 325, 15000000, 7500000, 5000000, ${ACTOR}::uuid)
        `);
      }),
    );

    // resolveRunStatutoryConfig resolves straight to a single StatutoryConfig
    // (domain.ts's resolveStatutoryConfig applied to whatever rows it saw),
    // not a row array -- RLS-blindness here doesn't show up as an empty
    // array, it shows up as silently substituting DEFAULT_STATUTORY_CONFIG
    // (pfRatePct 12) in place of the tenant's real, configured override (10).
    const viaBareDb = await resolveRunStatutoryConfig(db, tenant, "2026-06");
    console.log(`[resolveRunStatutoryConfig sweep] bare-db pfRatePct=${viaBareDb.pfRatePct} (tenant really configured pfRatePct=10)`);
    expect(viaBareDb.pfRatePct).toBe(12n);

    // Wrapped in runWithTenant for the same reason as resolvePtSlabs above.
    const viaScoped = await runWithTenant(tenant, () => scopedRead((tx) => resolveRunStatutoryConfig(tx, tenant, "2026-06")));
    expect(viaScoped.pfRatePct).toBe(10n);
  });
});

describe("Sweep extras: dead-code writes with the identical anti-pattern (bare db.execute INSERT into a FORCE RLS table, outside any transaction)", () => {
  it("insertArrear succeeds and the row is really persisted (payroll.payroll_arrears)", async () => {
    const tenant = randomUUID();
    const empId = randomUUID();
    const row = (await runWithTenant(tenant, () =>
      insertArrear({
        tenantId: tenant, employeeId: empId, componentCode: "BASIC",
        fromPeriod: "2026-01", toPeriod: "2026-02", oldAmountMinor: 100000, newAmountMinor: 200000,
        reason: "fixture", actorId: ACTOR,
      }),
    )) as { id: string };
    expect(row?.id).toBeDefined();
    const check = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_arrears WHERE id = ${row.id}::uuid`)),
    )) as unknown as Array<{ n: number }>;
    expect(check[0]?.n).toBe(1);
  });

  it("insertBonus succeeds and the row is really persisted (payroll.payroll_bonus)", async () => {
    const tenant = randomUUID();
    const empId = randomUUID();
    const row = (await runWithTenant(tenant, () =>
      insertBonus({ tenantId: tenant, employeeId: empId, fy: "2026", basicMinor: 500000, bonusPct: 8.33, bonusAmountMinor: 41650 }),
    )) as { id: string };
    expect(row?.id).toBeDefined();
    const check = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_bonus WHERE id = ${row.id}::uuid`)),
    )) as unknown as Array<{ n: number }>;
    expect(check[0]?.n).toBe(1);
  });

  it("insertReimbursement succeeds and the row is really persisted (payroll.payroll_reimbursements)", async () => {
    const tenant = randomUUID();
    const empId = randomUUID();
    const row = (await runWithTenant(tenant, () =>
      insertReimbursement({
        tenantId: tenant, employeeId: empId, category: "medical", amountMinor: 150000,
        billDate: "2026-03-01", billRef: "BILL-FIXVERIFY-1", period: "2026-03", actorId: ACTOR,
      }),
    )) as { id: string };
    expect(row?.id).toBeDefined();
    const check = (await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_reimbursements WHERE id = ${row.id}::uuid`)),
    )) as unknown as Array<{ n: number }>;
    expect(check[0]?.n).toBe(1);
  });
});
