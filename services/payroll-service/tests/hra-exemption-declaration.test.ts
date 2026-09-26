/**
 * BUG-HRA-1 regression: tax/consumer.ts's taxDeclarationSubmit handler
 * captured/stored the declared annual rent (rentPaidMinor) but never computed
 * hraClaimed (the Sec 10(13A) HRA exemption actually applied to reduce
 * taxable income) — every old-regime employee who declared rent was taxed as
 * if they had declared none, because tax/routes.ts's income-tax listing +
 * tax/computation endpoints and tax/form16.ts's Part B all read
 * `hraClaimed` directly off the stored declaration row rather than
 * recomputing it.
 *
 * Real Postgres + a real in-memory queue, with BOTH the HTTP app's routes
 * (buildApp()) and the worker's tax consumer (registerTaxConsumers, wrapped
 * with the same runWithTenant tenant-context shim worker.ts applies to every
 * consumer) registered against the ONE `@civitasone/queue` MemoryQueue
 * singleton (shared/infra.ts's `queue`) in this single vitest process.
 * Production runs the HTTP app and the worker as two separate processes,
 * each with its own independent in-memory queue under QUEUE_DRIVER=memory —
 * this harness exists purely so a single test can exercise the real
 * POST /tax-declarations -> queue -> consumer -> GET /tax/computation path
 * end to end, deterministically (queue.drain(), not a fixed sleep).
 *
 * Only the external HRMS boundary is mocked (same one-line stub pattern as
 * tests/dom-025-*.test.ts / tests/form16-pdf-coverage.test.ts) — DB, queue,
 * and outbox stay real.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerTaxConsumers } from "../src/modules/tax/consumer.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT   = "90000000-4801-4000-8000-000000000001";
const EMPLOYEE = "70000000-4801-4000-8000-0000000000e1";
const FY = "2025-26"; // startYear 2025 -> HRA snapshot month resolved as 2026-03

// Employee fixture: Rs 30,000/month basic, metro (X-class) city, 50% DA (top
// 7th-CPC HRA slab tier for X-class = 30% of basic) — same shape
// payroll/domain.ts's computeSlip() already derives HRA/DA from for a live
// payroll run, reused here via the mocked HRMS boundary.
const BASIC_MINOR = "3000000";  // Rs 30,000 (paise)
const DA_RATE_BPS = 5000;       // 50% DA
const CITY_CLASS = "X" as const;
const RENT_PAID_MINOR = 20_000_000; // Rs 2,00,000/year declared rent (the sweep's own repro figure)
const ANNUAL_GROSS_MINOR = 60_000_000n; // Rs 6,00,000 — one seeded slip stands in for the FY total (dom-025's own convention)

vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({
    month: "2026-03",
    employees: [{
      id: EMPLOYEE, employeeNo: "HRA1-EMP", fullName: "HRA Test Employee",
      basicMinor: BASIC_MINOR, dateOfJoining: "2020-01-01", payStructureId: null,
      bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null,
      cityClass: CITY_CLASS, taxRegime: "old", departmentId: "dept-1", pensionScheme: "EPF",
    }],
    lopDays: {}, overtimeHours: {},
  })),
  HrmsUnavailableError: class HrmsUnavailableError extends Error { readonly code = "HRMS_UNAVAILABLE"; },
}));

function token(sub: string, roles = ["employee"]) {
  return signToken({ sub, tid: TENANT, roles, sid: "hra1" }, SECRET);
}

// `queue` (shared/infra.ts) is typed to the generic `Queue` interface, but
// under QUEUE_DRIVER=memory (this suite's vitest.config.ts env) it is always
// a MemoryQueue, whose test-only `drain()` aid (resolve once every in-flight
// delivery — including this fix's own async HRMS/DA-rate lookups — has
// settled, instead of racing a fixed sleep) isn't part of that interface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = queue as any;

// Mirror worker.ts's tenant-context wrap: every consumer runs db.transaction()
// and relies on AsyncLocalStorage (runWithTenant) for the RLS tenant GUC —
// without this, the fix's own fresh reads (resolveDaRateBps inside the
// declaration's transaction) would silently see zero rows under RLS, not the
// tenant's real rows (see shared/db.ts's scopedRead doc comment / the
// "silent-DA-gap" comment on resolveDaRateBps itself).
let consumersRegistered = false;
function ensureConsumersRegistered(): void {
  if (consumersRegistered) return;
  consumersRegistered = true;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  registerTaxConsumers(queue);
}

/** Deterministic wait for the tax consumer to finish processing — see `q` above. */
async function drainQueue(): Promise<void> {
  await q.drain();
}

afterAll(async () => { await sqlClient.end(); });

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${TENANT}::uuid`);
    await tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  }));
}

/** Seeds the DA rate (needed for the fix's HRA computation) + one payroll slip (needed for tax/computation's annualGross). */
async function seedPayrollFixtures(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps)
      VALUES (${TENANT}::uuid, '2024-01-01'::date, ${DA_RATE_BPS})
    `);
    const runId = randomUUID();
    await tx.insert(payrollRuns).values({
      id: runId, tenantId: TENANT, runNo: "HRA1-RUN", month: "2025-06",
      structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n,
      currency: "INR", status: "approved", createdBy: EMPLOYEE, updatedBy: EMPLOYEE,
    });
    await tx.insert(payrollSlips).values({
      id: randomUUID(), tenantId: TENANT, runId, employeeId: EMPLOYEE, employeeNo: "HRA1-EMP",
      basicMinor: BigInt(BASIC_MINOR), grossMinor: ANNUAL_GROSS_MINOR, totalDeductionsMinor: 0n,
      netPayMinor: ANNUAL_GROSS_MINOR, currency: "INR", components: [], createdBy: EMPLOYEE, updatedBy: EMPLOYEE,
    });
  }));
}

async function readDeclarationRow(): Promise<{ hraClaimed: bigint; rentPaidMinor: bigint; regime: string } | null> {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT))));
  const row = rows[0];
  return row ? { hraClaimed: row.hraClaimed, rentPaidMinor: row.rentPaidMinor, regime: row.regime } : null;
}

beforeEach(() => { ensureConsumersRegistered(); });

describe("BUG-HRA-1 — old regime: declared rent now produces a real Sec 10(13A) exemption", () => {
  it("computes and stores hraClaimed, and tax/computation reflects it", async () => {
    await cleanup();
    try {
      await seedPayrollFixtures();

      const app = await buildApp();
      try {
        const submit = await app.inject({
          method: "POST",
          url: "/v1/payroll/tax-declarations",
          headers: { authorization: `Bearer ${token(EMPLOYEE)}` },
          payload: { fy: FY, regime: "old", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: RENT_PAID_MINOR },
        });
        expect(submit.statusCode).toBe(202);

        await drainQueue(); // deterministic wait for the consumer to finish, no fixed sleep

        // ── (1) hraClaimed persisted, hand-derived exactly per Sec 10(13A) ──
        // Basic 30,000/mo, DA 50% -> DA 15,000/mo -> salary(Basic+DA) annual
        // = (30,000+15,000)*12 = 5,40,000. 7th-CPC X-class HRA slab at DA>=50%
        // tier = 30% of basic -> HRA received annual = 9,000*12 = 1,08,000.
        // hraExemptionMinor = LEAST(
        //   HRA received       = 1,08,000
        //   rent - 10% salary  = 2,00,000 - 54,000 = 1,46,000
        //   50% salary (metro) = 2,70,000
        // ) = 1,08,000 (HRA received is the binding limb).
        const expectedHraClaimedMinor = 10_800_000n;

        const dec = await readDeclarationRow();
        expect(dec).not.toBeNull();
        expect(dec!.rentPaidMinor).toBe(BigInt(RENT_PAID_MINOR)); // was already correct pre-fix
        expect(dec!.hraClaimed).toBe(expectedHraClaimedMinor);    // BUG-HRA-1: was always 0n pre-fix

        // ── (2) tax/computation: exemptions include the real HRA figure, ──
        // taxableIncome drops accordingly, and — because it now crosses
        // below the old-regime Sec 87A rebate cap (Rs 5,00,000) — totalTax
        // drops from a real, non-zero liability all the way to zero.
        // exemptions = 80C(0) + 80D(0) + HRA(1,08,000) + other(0) + std ded (50,000) = 1,58,000
        // taxableIncome = round(max(0, 6,00,000 - 1,58,000)/10)*10 = 4,42,000
        // slab tax: (4,42,000-2,50,000)*5% = 9,600; taxable <= 5,00,000 rebate cap
        // -> 87A rebate = min(9600, 12500) = 9,600 -> after-rebate tax = 0 -> total tax = 0
        const comp = await app.inject({
          method: "GET",
          url: `/v1/payroll/tax/computation?fy=${FY}&regime=old`,
          headers: { authorization: `Bearer ${token(EMPLOYEE)}` },
        });
        expect(comp.statusCode).toBe(200);
        const body = comp.json();
        expect(body.exemptions).toBe(158_000);
        expect(body.taxableIncome).toBe(442_000);
        expect(body.totalTax).toBe(0);

        // Sanity check against the PRE-FIX behaviour this regression closes:
        // with hraClaimed stuck at 0, exemptions would have been only the
        // Rs 50,000 standard deduction, taxableIncome Rs 5,50,000 (above the
        // rebate cap), and totalTax a real Rs 23,400 — not the Rs 0 above.
        expect(body.taxableIncome).not.toBe(550_000);
        expect(body.totalTax).not.toBe(23_400);
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});

describe("BUG-HRA-1 — new regime: no Sec 10(13A) exemption, by statute", () => {
  it("stores hraClaimed=0 even when rent is declared, and never needs the DA/HRMS lookup", async () => {
    await cleanup();
    try {
      await seedPayrollFixtures(); // DA rate present, but must not even be consulted for new regime

      const app = await buildApp();
      try {
        const submit = await app.inject({
          method: "POST",
          url: "/v1/payroll/tax-declarations",
          headers: { authorization: `Bearer ${token(EMPLOYEE)}` },
          payload: { fy: FY, regime: "new", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: RENT_PAID_MINOR },
        });
        expect(submit.statusCode).toBe(202);
        await drainQueue();

        const dec = await readDeclarationRow();
        expect(dec).not.toBeNull();
        expect(dec!.regime).toBe("new");
        expect(dec!.rentPaidMinor).toBe(BigInt(RENT_PAID_MINOR));
        expect(dec!.hraClaimed).toBe(0n); // new regime: Income-tax Act disallows Sec 10(13A) entirely
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});

describe("BUG-HRA-1 — old regime, no rent declared", () => {
  it("stores hraClaimed=0 without requiring any DA-rate config or HRMS lookup", async () => {
    await cleanup(); // deliberately no seedPayrollFixtures(): no DA rate row exists for this tenant
    try {
      const app = await buildApp();
      try {
        const submit = await app.inject({
          method: "POST",
          url: "/v1/payroll/tax-declarations",
          headers: { authorization: `Bearer ${token(EMPLOYEE)}` },
          payload: { fy: FY, regime: "old", section80c: 100_000, section80d: 0, otherDeductions: 0, rentPaidMinor: 0 },
        });
        expect(submit.statusCode).toBe(202);
        await drainQueue();

        const dec = await readDeclarationRow();
        expect(dec).not.toBeNull(); // the rest of the declaration still saves...
        expect(dec!.hraClaimed).toBe(0n); // ...with hraClaimed correctly 0, and no DA_RATE_NOT_CONFIGURED failure
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});
