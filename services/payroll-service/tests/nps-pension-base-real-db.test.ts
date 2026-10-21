/**
 * GAP-PAYROLL-STATUTORY-NPS-05 -- the NPS ledger row records the pension base
 * (Basic + DA) the 10% / 14% were applied to, so a row can be checked by eye.
 *
 * Real Postgres (migrated through 0159), the real run consumer on the memory
 * queue and the real GET /v1/payroll/statutory/nps route; only the HRMS
 * boundary is stubbed. Requires DATABASE_URL pointing at your own disposable
 * Postgres (see vitest.config.ts REL-035).
 *
 * 2026-11 (30 days), tenant DA 55%, no HRA/other components:
 *   regular NPS member, Basic 15,000.00   -> DA 8,250.00, base 23,250.00
 *       employee 10% = 2,325.00 (232500 paise), employer 14% = 3,255.00 (325500)
 *   NPS member suspended from 2026-11-16 (FR 53, 15 regular days of 30)
 *       Basic 7,500.00 + DA 4,125.00 -> base 11,625.00
 *       employee 10% = 1,162.50 -> rounded to whole rupee 1,163.00 (116300 paise)
 *       employer 14% = 1,627.50 -> rounded to whole rupee 1,628.00 (162800 paise)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    fetchPayrollInput: vi.fn(),
    fetchEmployeeSummaries: vi.fn(async () => new Map()),
    fetchNpsPranLast4: vi.fn(async () => new Map()),
  };
});
vi.mock("../src/shared/hrms-retirement-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-retirement-client.js")>();
  return { ...actual, fetchRetirementAccounts: vi.fn(async () => null) };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { roundRupee } from "../src/modules/payroll/domain.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCTURE = randomUUID();
const DEPT = randomUUID();
const MONTH = "2026-11";
const ids = { regular: randomUUID(), suspended: randomUUID() };

const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "nps05" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>) => (await asTenant((tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;

const employee = (id: string, no: string, extra: Record<string, unknown> = {}) => ({
  id, employeeNo: no, fullName: no, basicMinor: "1500000", dateOfJoining: "2020-01-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true, ...extra,
});
const FEED = [
  employee(ids.regular, "NB-REG"),
  employee(ids.suspended, "NB-SUS", {
    payMode: "monthly", engagementType: "pay_scale", paySuspended: true, subsistencePct: 50,
    suspension: { suspensionId: randomUUID(), fromDate: "2026-11-16", toDate: null, revisedSubsistencePct: null, revisedEffectiveFrom: null, reviewOrderRef: null },
  }),
];

let app: FastifyInstance;
let runId = "";

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2026-01-01', 5500)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${STRUCTURE}::uuid, ${TENANT}::uuid, 'NB', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: MONTH, employees: FEED, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(), payload: { runNo: "NB-2026-11", month: MONTH, structureId: STRUCTURE } });
  expect([201, 202]).toContain(res.statusCode);
  runId = res.json().data?.id ?? res.json().id;
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const [run] = await q(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed") throw new Error(`run failed: ${run.last_error as string}`);
    if (regs.length > 0) break;
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}, 60_000);

afterAll(async () => {
  await asTenant(async (tx) => {
    for (const t of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps",
      "payroll.payroll_run_suspensions", "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_runs",
      "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
      await tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`));
    }
  });
  await app.close();
  await sqlClient.end();
});

async function npsRow(employeeId: string) {
  const [r] = await q(sql`SELECT basic_minor::text, pension_base_minor::text, emp_contrib_pct::text, er_contrib_pct::text,
    emp_contrib_minor::text, er_contrib_minor::text FROM statutory.payroll_nps WHERE run_id = ${runId}::uuid AND employee_id = ${employeeId}::uuid`);
  return r as { basic_minor: string; pension_base_minor: string | null; emp_contrib_pct: string; er_contrib_pct: string; emp_contrib_minor: string; er_contrib_minor: string } | undefined;
}

describe("NPS ledger row records the pension base (GAP-PAYROLL-STATUTORY-NPS-05)", () => {
  it("a regular member: base = Basic + DA (23,250.00), and the 10% / 14% are exactly that base's share, not Basic's", async () => {
    const r = (await npsRow(ids.regular))!;
    expect(r.basic_minor).toBe("1500000");          // Basic only, as before
    expect(r.pension_base_minor).toBe("2325000");   // Basic 15,000.00 + DA 55% 8,250.00
    expect(r.emp_contrib_minor).toBe("232500");     // 10% of the BASE (10% of Basic would be 150000)
    expect(r.er_contrib_minor).toBe("325500");      // 14% of the base
    // the recorded base reproduces the recorded contributions
    const base = BigInt(r.pension_base_minor!);
    expect(roundRupee((base * 10n) / 100n)).toBe(BigInt(r.emp_contrib_minor));
    expect(roundRupee((base * 14n) / 100n)).toBe(BigInt(r.er_contrib_minor));
  });

  it("a suspended member (FR 53): base = the regular days' Basic + DA only (11,625.00)", async () => {
    const r = (await npsRow(ids.suspended))!;
    expect(r.pension_base_minor).toBe("1162500");   // 15/30 x (15,000.00 + 8,250.00)
    expect(r.emp_contrib_minor).toBe("116300");     // 1,162.50 -> whole rupee 1,163.00
    expect(r.er_contrib_minor).toBe("162800");      // 1,627.50 -> whole rupee 1,628.00
    const base = BigInt(r.pension_base_minor!);
    expect(roundRupee((base * 10n) / 100n)).toBe(BigInt(r.emp_contrib_minor));
  });

  it("GET /v1/payroll/statutory/nps exposes pensionBaseMinor, matching the ledger row", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps?limit=500", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ employeeId: string; basicMinor: number; pensionBaseMinor: number | null; empContribMinor: number; erContribMinor: number }>;
    const mine = rows.find((x) => x.employeeId === ids.regular)!;
    expect(mine).toMatchObject({ basicMinor: 1500000, pensionBaseMinor: 2325000, empContribMinor: 232500, erContribMinor: 325500 });
  });

  it("a row written before migration 0159 (base NULL) is reported as null, never reconstructed", async () => {
    const legacySlip = randomUUID();
    await q(sql`INSERT INTO statutory.payroll_nps (tenant_id, slip_id, employee_id, run_id, basic_minor, emp_contrib_minor, er_contrib_minor, period, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${legacySlip}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, 1000000, 100000, 140000, '2026-01', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps?limit=500", headers: hdr() });
    const legacy = (res.json() as Array<{ period: string; pensionBaseMinor: number | null; basicMinor: number }>).find((x) => x.period === "2026-01")!;
    expect(legacy.basicMinor).toBe(1000000);
    expect(legacy.pensionBaseMinor).toBeNull();
  });

  it("the column rejects a negative base (CHECK)", async () => {
    await expect(
      q(sql`INSERT INTO statutory.payroll_nps (tenant_id, slip_id, employee_id, run_id, basic_minor, pension_base_minor, emp_contrib_minor, er_contrib_minor, period, created_by, updated_by)
        VALUES (${TENANT}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, 1, -1, 0, 0, '2026-02', ${ACTOR}::uuid, ${ACTOR}::uuid)`),
    ).rejects.toThrow();
  });
});
