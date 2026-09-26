/**
 * Regression test: DA silently missing from gross pay on a REAL, CONFIGURED
 * DA rate (bug-fix: silent-DA-gap / RLS-scoping).
 *
 * processPayrollRun (and processPensionRun's DR) resolved the tenant's DA
 * rate via resolveDaRateBps(db, ...) -- the bare, module-level `db`, called
 * BEFORE either function's own db.transaction() opens. payroll
 * .dearness_allowance_rates has FORCE ROW LEVEL SECURITY (migration
 * 0036_rls_completeness.sql); a query on the bare `db` carries no
 * app.tenant_id GUC, so the fail-closed RLS policy returned ZERO rows no
 * matter what was actually configured for the tenant (see shared/db.ts's
 * `scopedRead` doc comment). resolveDaRateBps's own "no rows" fallback
 * (`v != null ? BigInt(v) : 0n`) then silently resolved to 0n -- NOT because
 * no rate was configured, but because RLS hid every row from this specific
 * query. That 0n flowed into computeSlip() as daRateBps, so
 * `daMinor = roundRupee(basicMinor * 0n / 10000n)` was always 0, and
 * computeSlip's `if (daMinor > 0n)` guard (domain.ts) never added a DA
 * earning line at all -- DA vanished completely from the persisted slip's
 * components AND from grossMinor (a plain sum over the earnings actually
 * pushed), for every real run with a real, configured DA rate. The exact same
 * daRateBps=0n also pinned hraSlabPct()'s DA-escalation tier to its LOWEST
 * band regardless of the real rate, so HRA was silently wrong too.
 *
 * The only other call site (generateRetroArrears, see
 * retro-arrears-historical-da-rate.test.ts) already passed its caller's own
 * open, tenant-scoped `tx` and was never affected -- which is why that test
 * alone existing did not catch this.
 *
 * This test seeds a real 50% DA rate and runs 4 employees at 2 basic-pay
 * levels across all 3 HRA city classes (X/Y/Z) through the REAL queue
 * consumer end-to-end (registerPayrollConsumers + COMMANDS.runCreate), and
 * asserts DA appears as its own correctly-valued component and that
 * grossMinor exactly equals Basic + DA + city-class HRA + fixed TA for every
 * one of them.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollSlips, payrollStructures, payrollComponents } from "../src/modules/payroll/schema.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { hraSlabPct, roundRupee, type CityClass } from "../src/modules/payroll/domain.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "91000000-0000-4021-8000-0000000000b2";
const RUN_MONTH = "2026-09";
const DA_RATE_BPS = 5000n; // 50% -- matches the sweep's methodology exactly.
const TA_FIXED_MINOR = 200_000n; // ₹2,000 fixed Transport Allowance.

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";

afterAll(async () => {
  await sqlClient.end();
});

describe("bug-fix (silent-DA-gap): gross pay includes DA when a real DA rate is configured", () => {
  it("4 employees, 2 basic levels, 3 city classes: gross === Basic + DA + city-class HRA + fixed TA for every one", async () => {
    const tenant = randomUUID();
    const structureId = randomUUID();
    const stateCode = "KA";

    // 2 basic-pay levels (30,000 / 50,000) x all 3 HRA city classes (X/Y/Z),
    // across 4 employees -- the sweep's exact methodology.
    const employees = [
      { id: randomUUID(), employeeNo: "E-0", fullName: "Employee 0", basicMinor: "3000000", cityClass: "X" as CityClass },
      { id: randomUUID(), employeeNo: "E-1", fullName: "Employee 1", basicMinor: "3000000", cityClass: "Y" as CityClass },
      { id: randomUUID(), employeeNo: "E-2", fullName: "Employee 2", basicMinor: "5000000", cityClass: "Z" as CityClass },
      { id: randomUUID(), employeeNo: "E-3", fullName: "Employee 3", basicMinor: "5000000", cityClass: "X" as CityClass },
    ].map((e) => ({
      ...e,
      dateOfJoining: "2020-01-01",
      payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: null,
      taxRegime: "new" as const, pensionScheme: "NPS" as const, stateCode,
    }));

    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        // Real, configured DA rate -- NOT the "unconfigured" case (that is
        // PR #1595's separate, still-open fix). This rate genuinely exists
        // for this tenant/period and must be visible to the run.
        await tx.execute(sql`
          INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps)
          VALUES (${tenant}::uuid, '2026-01-01'::date, ${DA_RATE_BPS})
        `);
        // A real payroll structure with a fixed Transport Allowance component.
        // BASIC/DA/HRA are computed specially by computeSlip() regardless of
        // structure config -- only the "something else legitimately in
        // gross" TA needs a real structure row.
        await tx.insert(payrollStructures).values({
          id: structureId, tenantId: tenant, name: "Standard", isDefault: true,
          status: "active", createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(payrollComponents).values({
          id: randomUUID(), tenantId: tenant, structureId, code: "TA", name: "Transport Allowance",
          componentType: "earning", fixedMinor: TA_FIXED_MINOR, createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.execute(sql`
          INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor)
          VALUES (${tenant}::uuid, ${stateCode}, 0, 999999999999, 20000)
        `);
      }),
    );

    (fetchPayrollInput as ReturnType<typeof vi.fn>).mockImplementation(async (t: string, month: string) => {
      if (t !== tenant) return { month, employees: [], lopDays: {} };
      return { month, employees, lopDays: {} };
    });

    const runId = randomUUID();
    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    await queue.publish(COMMANDS.runCreate, {
      messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: tenant, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId: tenant, runNo: `RUN-${tenant.slice(0, 8)}`, month: RUN_MONTH, structureId },
    });
    await queue.drain();
    expect(queue.dlq, `queue DLQ: ${JSON.stringify(queue.dlq)}`).toHaveLength(0);

    const slips = await runWithTenant(tenant, () =>
      db.transaction((tx) =>
        tx.select().from(payrollSlips).where(sql`${payrollSlips.tenantId} = ${tenant}::uuid AND ${payrollSlips.runId} = ${runId}::uuid`),
      ),
    );
    expect(slips).toHaveLength(4);

    for (const emp of employees) {
      const slip = slips.find((s) => s.employeeId === emp.id);
      expect(slip, `slip for ${emp.employeeNo}`).toBeTruthy();

      const basicMinor = BigInt(emp.basicMinor);
      const daMinor = roundRupee((basicMinor * DA_RATE_BPS) / 10000n);
      const hraPct = hraSlabPct(emp.cityClass, DA_RATE_BPS); // 50% DA >= 5000bps -> highest slab tier
      const hraMinor = roundRupee((basicMinor * hraPct) / 100n);
      const expectedGross = basicMinor + daMinor + hraMinor + TA_FIXED_MINOR;

      const components = slip!.components as Array<{ code: string; type: string; amountMinor: number }>;
      const da = components.find((c) => c.code === "DA");
      const hra = components.find((c) => c.code === "HRA");
      const ta = components.find((c) => c.code === "TA");
      const basic = components.find((c) => c.code === "BASIC");

      // The actual bug: DA must be its OWN present, non-zero line item -- not
      // absent (pre-fix: no DA component at all, not even a zero one).
      expect(da, `DA component missing for ${emp.employeeNo} (city ${emp.cityClass}, basic ${emp.basicMinor})`).toBeTruthy();
      expect(da?.amountMinor, `DA amount for ${emp.employeeNo}`).toBe(Number(daMinor));
      expect(da!.amountMinor).toBeGreaterThan(0);

      // HRA's DA-escalation tier must also reflect the real 50% rate, not the
      // bug's silently-pinned lowest tier.
      expect(hra?.amountMinor, `HRA amount for ${emp.employeeNo} (city ${emp.cityClass})`).toBe(Number(hraMinor));

      expect(basic?.amountMinor, `BASIC amount for ${emp.employeeNo}`).toBe(Number(basicMinor));
      expect(ta?.amountMinor, `TA amount for ${emp.employeeNo}`).toBe(Number(TA_FIXED_MINOR));

      // The headline assertion: gross === Basic + DA + city-class HRA + fixed TA.
      expect(slip!.grossMinor, `grossMinor for ${emp.employeeNo} (city ${emp.cityClass}, basic ${emp.basicMinor})`).toBe(expectedGross);
    }
  }, { timeout: 30_000 });
});
