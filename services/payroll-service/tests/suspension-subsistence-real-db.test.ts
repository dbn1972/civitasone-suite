/**
 * URGENT money fix (FR 53): payroll paid SUSPENDED employees full salary.
 * hrms-service's payroll-input feed flags `paySuspended`, but nothing in the
 * payroll-service package read it.
 *
 * Real Postgres, real queue consumer (COMMANDS.runCreate -> processPayrollRun),
 * only the HRMS HTTP client mocked -- and even that mock runs the real feed
 * validator (parsePayrollInput), so the zod boundary is on the path.
 *
 * Fixture: basic Rs 50,000, DA 50%, city X (HRA 30%), GPF, new regime,
 * structure TA Rs 1,800 + CCA Rs 600 earnings and CGEGIS Rs 60 deduction,
 * run month 2026-09 (30 days).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { PayrollInputEmployee } from "../src/shared/hrms-client.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCT = randomUUID();
const DEPT = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const MONTH = "2026-09";

const E_NORMAL = randomUUID();   // not suspended -> must be byte-identical to origin/main
const E_FULL = randomUUID();     // suspended 2026-08-01: whole month at 50%
const E_MID = randomUUID();      // suspended 2026-09-11: 10 regular days + 20 SA days
const E_R75 = randomUUID();      // suspended 2026-05-01, review order 75%
const E_R25 = randomUUID();      // suspended 2026-05-01, review order 25%
const E_NOREV = randomUUID();    // suspended 2026-05-01, no review order
const E_CROSS = randomUUID();    // suspended 2026-07-01, 75% order: day 91 = 2026-09-29
const E_CONTRACT = randomUUID(); // contractual engagement, suspended -> withheld

function emp(id: string, no: string, extra: Partial<PayrollInputEmployee> & Record<string, unknown> = {}): PayrollInputEmployee {
  return {
    id, employeeNo: no, fullName: no, basicMinor: "5000000", dateOfJoining: "2020-01-01", payStructureId: STRUCT,
    bankAccountNo: null, bankIfsc: null, pan: null, uan: null, cityClass: "X", taxRegime: "new",
    departmentId: DEPT, pensionScheme: "GPF", payMode: "monthly", engagementType: "pay_scale",
    paySuspended: false,
    ...extra,
  } as PayrollInputEmployee;
}
function susp(fromDate: string, revised: number | null = null, extra: Record<string, unknown> = {}) {
  return {
    paySuspended: true, subsistencePct: 50,
    suspension: {
      suspensionId: randomUUID(), fromDate, toDate: null,
      revisedSubsistencePct: revised, revisedEffectiveFrom: null,
      reviewOrderRef: revised == null ? null : "VIG/2026/7",
    },
    ...extra,
  };
}
const RAW_FEED = {
  month: MONTH,
  employees: [
    emp(E_NORMAL, "E0-NORMAL"),
    emp(E_FULL, "E1-FULL", susp("2026-08-01")),
    emp(E_MID, "E2-MID", susp("2026-09-11")),
    emp(E_R75, "E3-R75", susp("2026-05-01", 75)),
    emp(E_R25, "E4-R25", susp("2026-05-01", 25)),
    emp(E_NOREV, "E5-NOREV", susp("2026-05-01")),
    emp(E_CROSS, "E6-CROSS", susp("2026-07-01", 75)),
    emp(E_CONTRACT, "E7-CONTRACT", { ...susp("2026-09-01"), payMode: "consolidated", engagementType: "contractual", pensionScheme: "EPF" }),
  ],
  lopDays: {},
  overtimeHours: {},
};

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    // The real boundary validator runs on the raw feed.
    fetchPayrollInput: vi.fn(async () => actual.parsePayrollInput(JSON.parse(JSON.stringify(RAW_FEED)))),
    fetchEmployeeSummaries: vi.fn(async () => new Map()),
  };
});

const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
const { COMMANDS } = await import("../src/topics.js");
const { buildApp } = await import("../src/app.js");
const memQueue = queue as unknown as MemoryQueue;

const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

type Comp = { code: string; name: string; type: string; amountMinor: number };
type Slip = {
  employee_id: string; basic_minor: string; gross_minor: string; total_deductions_minor: string; net_pay_minor: string;
  pf_employee_minor: string; pf_employer_minor: string; gpf_minor: string; nps_employee_minor: string; nps_employer_minor: string;
  esi_minor: string; tds_minor: string; status: string; components: Comp[];
};
async function slip(employeeId: string): Promise<Slip | undefined> {
  const rows = (await inTenant((tx) => tx.execute(sql`
    SELECT employee_id::text, basic_minor::text, gross_minor::text, total_deductions_minor::text, net_pay_minor::text,
           pf_employee_minor::text, pf_employer_minor::text, gpf_minor::text, nps_employee_minor::text, nps_employer_minor::text,
           esi_minor::text, tds_minor::text, status, components
      FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid AND employee_id = ${employeeId}::uuid
  `))) as unknown as Slip[];
  return rows[0];
}
const earn = (s: Slip) => Object.fromEntries(s.components.filter((c) => c.type === "earning").map((c) => [c.code, c.amountMinor]));
const sumEarnings = (s: Slip) => s.components.filter((c) => c.type === "earning").reduce((a, c) => a + c.amountMinor, 0);

type Line = { employee_id: string; treatment: string; regular_days: number; subsistence_days: number; subsistence_minor: string; subsistence_da_minor: string; revised_pct_bps: number | null; flags: string[] };
async function line(employeeId: string): Promise<Line | undefined> {
  const rows = (await inTenant((tx) => tx.execute(sql`
    SELECT employee_id::text, treatment, regular_days, subsistence_days, subsistence_minor::text, subsistence_da_minor::text, revised_pct_bps, flags
      FROM payroll.payroll_run_suspensions WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid AND employee_id = ${employeeId}::uuid
  `))) as unknown as Line[];
  return rows[0];
}

const RUN = randomUUID();
async function publishRun(): Promise<void> {
  await queue.publish(COMMANDS.runCreate, {
    messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: RUN, tenantId: TENANT, runNo: `RUN-${MONTH}-SUSP`, month: MONTH, structureId: STRUCT, runType: "regular" },
  });
  await memQueue.drain();
}

beforeAll(async () => {
  await inTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, created_by, updated_by) VALUES (${STRUCT}::uuid, ${TENANT}::uuid, 'S', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    for (const [code, name, type, fixed] of [["TA", "Transport Allowance", "earning", 180000], ["CCA", "City Compensatory Allowance", "earning", 60000], ["CGEGIS", "CGEGIS", "deduction", 6000]] as const) {
      await tx.execute(sql`INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, fixed_minor, created_by, updated_by)
        VALUES (${TENANT}::uuid, ${STRUCT}::uuid, ${code}, ${name}, ${type}, ${fixed}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    }
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2026-01-01'::date, 5000)`);
  });
  registerPayrollConsumers(queue);
  await queue.start();
  await publishRun();
});
afterAll(async () => {
  await queue.stop();
  await sqlClient.end();
});

describe("FR 53: a suspended pay-scale employee is paid subsistence allowance, not full salary", () => {
  it("whole month suspended (days 32-61): 50% of basic as SA + DA on it; HRA/CCA continue; no Basic/DA/TA", async () => {
    const s = (await slip(E_FULL))!;
    expect(earn(s)).toEqual({ HRA: 1_500_000, SUBSISTENCE_ALLOWANCE: 2_500_000, SA_DA: 1_250_000, CCA: 60_000 });
    expect(s.components.find((c) => c.code === "SUBSISTENCE_ALLOWANCE")?.name).toBe("Subsistence Allowance");
    expect(s.gross_minor).toBe("5310000");
    // Full salary would have been Basic 50,000 + DA 25,000 + HRA 15,000 + TA 1,800 + CCA 600.
    expect(Number(s.gross_minor)).toBeLessThan(9_240_000);
    expect(s.basic_minor).toBe("0");
    // FR 53(2)(ii): no GPF subscription from subsistence allowance; and no
    // all-zero EPF row for a GPF member.
    expect(s.gpf_minor).toBe("0");
    const pfRows = (await inTenant((tx) => tx.execute(sql`SELECT 1 FROM statutory.payroll_pf WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid AND employee_id = ${E_FULL}::uuid`))) as unknown as unknown[];
    expect(pfRows.length).toBe(0);
    // Compulsory deductions survive (FR 53(2)(i)); money adds up.
    expect(s.components.find((c) => c.code === "CGEGIS")?.amountMinor).toBe(6_000);
    expect(BigInt(s.gross_minor) - BigInt(s.total_deductions_minor)).toBe(BigInt(s.net_pay_minor));
    expect(Number(s.gross_minor)).toBe(sumEarnings(s));
    const l = (await line(E_FULL))!;
    expect(l).toMatchObject({ treatment: "subsistence", regular_days: 0, subsistence_days: 30, subsistence_minor: "2500000", subsistence_da_minor: "1250000", flags: [] });
  });

  it("mid-month suspension (from 11th): 10 days regular pay + 20 days subsistence", async () => {
    const s = (await slip(E_MID))!;
    expect(earn(s)).toEqual({
      BASIC: 1_666_700, DA: 833_300, HRA: 1_500_000,
      SUBSISTENCE_ALLOWANCE: 1_666_700, SA_DA: 833_300,
      TA: 60_000, CCA: 60_000,
    });
    expect(s.basic_minor).toBe("1666700");
    // GPF 10% on the regular days' Basic + DA only (2,500,000).
    expect(s.gpf_minor).toBe("250000");
    const gpf = (await inTenant((tx) => tx.execute(sql`SELECT emp_contrib_minor::text AS c FROM statutory.payroll_gpf WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid AND employee_id = ${E_MID}::uuid`))) as unknown as Array<{ c: string }>;
    expect(gpf.map((r) => r.c)).toEqual(["250000"]);
    expect(await line(E_MID)).toMatchObject({ treatment: "subsistence", regular_days: 10, subsistence_days: 20, flags: [] });
  });

  it("after 90 days with a recorded 75% review order", async () => {
    const s = (await slip(E_R75))!;
    expect(earn(s)).toEqual({ HRA: 1_500_000, SUBSISTENCE_ALLOWANCE: 3_750_000, SA_DA: 1_875_000, CCA: 60_000 });
    expect(await line(E_R75)).toMatchObject({ revised_pct_bps: 7500, flags: [] });
  });

  it("after 90 days with a recorded 25% review order", async () => {
    const s = (await slip(E_R25))!;
    expect(earn(s)).toEqual({ HRA: 1_500_000, SUBSISTENCE_ALLOWANCE: 1_250_000, SA_DA: 625_000, CCA: 60_000 });
    expect(await line(E_R25)).toMatchObject({ revised_pct_bps: 2500, flags: [] });
  });

  it("after 90 days with NO review order: stays at 50% and raises REVIEW_ORDER_DUE", async () => {
    const s = (await slip(E_NOREV))!;
    expect(earn(s)).toEqual({ HRA: 1_500_000, SUBSISTENCE_ALLOWANCE: 2_500_000, SA_DA: 1_250_000, CCA: 60_000 });
    expect(await line(E_NOREV)).toMatchObject({ revised_pct_bps: null, flags: ["REVIEW_ORDER_DUE"] });
  });

  it("the 90-day boundary inside the month splits the rate (28 days at 50%, 2 days at 75%)", async () => {
    const s = (await slip(E_CROSS))!;
    expect(earn(s)).toEqual({ HRA: 1_500_000, SUBSISTENCE_ALLOWANCE: 2_583_300, SA_DA: 1_291_700, CCA: 60_000 });
    expect(await line(E_CROSS)).toMatchObject({ subsistence_days: 30, revised_pct_bps: 7500, flags: [] });
  });

  it("a contract engagement is withheld (no slip) and flagged for HR, not given FR 53", async () => {
    expect(await slip(E_CONTRACT)).toBeUndefined();
    expect(await line(E_CONTRACT)).toMatchObject({
      treatment: "withheld", subsistence_minor: "0", flags: ["NON_GOVERNMENT_ENGAGEMENT_WITHHELD"],
    });
  });

  it("a non-suspended employee's slip is byte-identical to origin/main's", async () => {
    const s = (await slip(E_NORMAL))!;
    // Golden values captured by running this exact fixture through the
    // payroll run on origin/main (b0381d435), before this change.
    expect({ ...s, employee_id: "E0" }).toEqual(GOLDEN_NORMAL);
    expect(await line(E_NORMAL)).toBeUndefined();
  });
});

describe("run summary, audit, register, idempotency", () => {
  it("GET /v1/payroll/runs/:id lists every suspended employee with treatment and flags", async () => {
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "sess-susp" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${RUN}`, headers: { authorization: `Bearer ${token}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { employeeCount: number; suspendedEmployees: Array<{ employeeNo: string; treatment: string; subsistenceAllowance: number; flags: string[] }> };
    expect(body.employeeCount).toBe(7); // the withheld contract employee has no slip
    expect(body.suspendedEmployees.map((e) => [e.employeeNo, e.treatment])).toEqual([
      ["E1-FULL", "subsistence"], ["E2-MID", "subsistence"], ["E3-R75", "subsistence"], ["E4-R25", "subsistence"],
      ["E5-NOREV", "subsistence"], ["E6-CROSS", "subsistence"], ["E7-CONTRACT", "withheld"],
    ]);
    expect(body.suspendedEmployees.find((e) => e.employeeNo === "E1-FULL")?.subsistenceAllowance).toBe(25000);
    expect(body.suspendedEmployees.find((e) => e.employeeNo === "E5-NOREV")?.flags).toEqual(["REVIEW_ORDER_DUE"]);
  });

  it("emits one audit event per suspended employee and keeps the register equal to the slip totals", async () => {
    const audits = (await inTenant((tx) => tx.execute(sql`
      SELECT payload->>'action' AS action, payload->>'employeeId' AS emp FROM _outbox.messages
       WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceType' = 'payroll_run_suspension'
    `))) as unknown as Array<{ action: string; emp: string }>;
    expect(audits.filter((a) => a.action === "subsistence_applied").length).toBe(6);
    expect(audits.filter((a) => a.action === "pay_withheld").map((a) => a.emp)).toEqual([E_CONTRACT]);

    const reg = (await inTenant((tx) => tx.execute(sql`SELECT SUM(total_gross_minor)::text AS g, SUM(employee_count)::int AS n FROM payroll.payroll_register WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid`))) as unknown as Array<{ g: string; n: number }>;
    const slips = (await inTenant((tx) => tx.execute(sql`SELECT SUM(gross_minor)::text AS g, COUNT(*)::int AS n FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid`))) as unknown as Array<{ g: string; n: number }>;
    expect(reg[0]).toEqual(slips[0]);
  });

  it("re-delivering the run is idempotent: no duplicate slips, suspension lines or audit events", async () => {
    await publishRun();
    const counts = (await inTenant((tx) => tx.execute(sql`
      SELECT (SELECT COUNT(*)::int FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid) AS slips,
             (SELECT COUNT(*)::int FROM payroll.payroll_run_suspensions WHERE tenant_id = ${TENANT}::uuid AND run_id = ${RUN}::uuid) AS lines,
             (SELECT COUNT(*)::int FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceType' = 'payroll_run_suspension') AS audits
    `))) as unknown as Array<{ slips: number; lines: number; audits: number }>;
    expect(counts[0]).toEqual({ slips: 7, lines: 7, audits: 7 });
  });
});

describe("FR 53 percentages are tenant-configurable (payroll_settings, migration 0057)", () => {
  it("settings update stores the tenant's rates; an omitted rate keeps its stored value; the run resolver reads them", async () => {
    const { resolveSubsistenceConfig } = await import("../src/modules/payroll/subsistence-repo.js");
    const t2 = randomUUID();
    const read = () => runWithTenant(t2, () => db.transaction((tx) => resolveSubsistenceConfig(tx as unknown as typeof db, t2)));
    // No row yet -> FR 53 defaults.
    expect(await read()).toEqual({ initialPctBps: 5000n, reviewAfterDays: 90, revisedMinPctBps: 2500n, revisedMaxPctBps: 7500n });
    const send = async (payload: Record<string, unknown>) => {
      await queue.publish(COMMANDS.settingsUpdate, {
        messageId: randomUUID(), type: COMMANDS.settingsUpdate, tenantId: t2, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: t2, protectedNetFloorMinor: 0, ...payload },
      });
      await memQueue.drain();
    };
    await send({ subsistenceInitialPctBps: 4000, subsistenceRevisedMaxPctBps: 7000 });
    expect(await read()).toEqual({ initialPctBps: 4000n, reviewAfterDays: 90, revisedMinPctBps: 2500n, revisedMaxPctBps: 7000n });
    await send({ protectedNetFloorMinor: 100000 });
    expect(await read()).toEqual({ initialPctBps: 4000n, reviewAfterDays: 90, revisedMinPctBps: 2500n, revisedMaxPctBps: 7000n });

    // Review fix: the audit event carries before/after values.
    const audits = (await runWithTenant(t2, () => db.transaction((tx) => tx.execute(sql`
      SELECT payload->'before' AS before, payload->'after' AS after FROM _outbox.messages
       WHERE tenant_id = ${t2}::uuid AND payload->>'resourceType' = 'payroll_settings'
       ORDER BY created_at, id
    `)))) as unknown as Array<{ before: Record<string, unknown> | null; after: Record<string, unknown> }>;
    expect(audits).toHaveLength(2);
    expect(audits[0]!.before).toBeNull();
    expect(audits[0]!.after).toMatchObject({ subsistenceInitialPctBps: 4000, subsistenceReviewAfterDays: 90, subsistenceRevisedMinPctBps: 2500, subsistenceRevisedMaxPctBps: 7000 });
    expect(audits[1]!.before).toMatchObject({ protectedNetFloorMinor: "0", subsistenceInitialPctBps: 4000, subsistenceRevisedMaxPctBps: 7000 });
    expect(audits[1]!.after).toMatchObject({ protectedNetFloorMinor: "100000", subsistenceInitialPctBps: 4000, subsistenceRevisedMaxPctBps: 7000 });

    // Review fix: a partial update is validated against the STORED values.
    const put = async (payload: Record<string, unknown>) => {
      const token = signToken({ sub: ACTOR, tid: t2, roles: ["payroll_admin"], sid: "sess-set" }, SECRET);
      const app = await buildApp();
      const r = await app.inject({ method: "PUT", url: "/v1/payroll/settings", headers: { authorization: `Bearer ${token}` }, payload });
      await app.close();
      return r.statusCode;
    };
    expect(await put({ protectedNetFloorMinor: 0, subsistenceRevisedMinPctBps: 8000 })).toBe(400); // > stored max 7000
    expect(await put({ protectedNetFloorMinor: 0, subsistenceRevisedMaxPctBps: 2000 })).toBe(400); // < stored min 2500
    expect(await put({ protectedNetFloorMinor: 0, subsistenceRevisedMinPctBps: 3000 })).toBe(202);

    // Defence in depth: a command whose merge is invalid is rejected by the
    // consumer without touching the stored row (no DB CHECK violation loop).
    await memQueue.drain(); // apply the accepted min=3000 update
    expect(await read()).toEqual({ initialPctBps: 4000n, reviewAfterDays: 90, revisedMinPctBps: 3000n, revisedMaxPctBps: 7000n });
    await send({ subsistenceRevisedMinPctBps: 9000 });
    expect(await read()).toEqual({ initialPctBps: 4000n, reviewAfterDays: 90, revisedMinPctBps: 3000n, revisedMaxPctBps: 7000n });
  });
});

// Captured from origin/main b0381d435 (see the PR description for how).
const GOLDEN_NORMAL = {"employee_id":"E0","basic_minor":"5000000","gross_minor":"9240000","total_deductions_minor":"756000","net_pay_minor":"8484000","pf_employee_minor":"0","pf_employer_minor":"0","gpf_minor":"750000","nps_employee_minor":"0","nps_employer_minor":"0","esi_minor":"0","tds_minor":"0","status":"computed","components":[{"code":"BASIC","name":"Basic Pay","type":"earning","amountMinor":5000000},{"code":"DA","name":"Dearness Allowance","type":"earning","amountMinor":2500000},{"code":"HRA","name":"House Rent Allowance","type":"earning","amountMinor":1500000},{"code":"TA","name":"Transport Allowance","type":"earning","amountMinor":180000},{"code":"CCA","name":"City Compensatory Allowance","type":"earning","amountMinor":60000},{"code":"CGEGIS","name":"CGEGIS","type":"deduction","amountMinor":6000}]};
