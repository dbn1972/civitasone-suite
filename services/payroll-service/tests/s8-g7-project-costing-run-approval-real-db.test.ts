/**
 * S8 G7 - the run-approval hook, end to end on a real Postgres: real slips from
 * computeAndInsertSlip, real approveRun + consumer. The cost lines must tie to
 * the figures the GL accrual uses (payroll.run.approved), be absent while the
 * tenant flag is off, and a costing failure must never block the approval.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/payroll/repo.js";
import { registerPayrollConsumers, computeAndInsertSlip } from "../src/modules/payroll/consumer.js";
import { approveRun } from "../src/modules/payroll/commands.js";
import { EVENTS } from "../src/topics.js";

const memQueue = queue as unknown as MemoryQueue;
const R = (rupees: number): bigint => BigInt(rupees) * 100n;
type Tx = typeof db;
const creator = randomUUID();
const approver = randomUUID();
const inTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));
const q = <T = Record<string, unknown>>(tenant: string, s: ReturnType<typeof sql>) => inTenant(tenant, async (tx) => (await tx.execute(s)) as unknown as T[]);
const P1 = randomUUID(), P2 = randomUUID(), CC1 = randomUUID(), CC2 = randomUUID();

beforeAll(async () => {
  registerPayrollConsumers(queue); await queue.start();
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2026-08", employees: [], lopDays: {}, overtimeHours: {} } as never);
});
afterAll(async () => { await queue.stop(); await sqlClient.end(); });

async function newRun(tenant: string, month: string): Promise<string> {
  const runId = randomUUID();
  await inTenant(tenant, (tx) => repo.insertRun(tx as never, {
    id: runId, tenantId: tenant, runNo: `G7-${runId.slice(0, 8)}`, month, departmentId: null, structureId: randomUUID(), runType: "regular",
    ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "computed", createdBy: creator, updatedBy: creator,
  }));
  return runId;
}
async function addSlip(tenant: string, runId: string, employeeId: string, no: string, basic: bigint) {
  await inTenant(tenant, (tx) => computeAndInsertSlip(tx as never, { actorId: creator }, {
    runId, tenantId: tenant, employeeId, employeeNo: no, basicMinor: basic, month: "2026-08", pensionScheme: "NPS",
    fyStartYear: 2026, taxRegime: "new", statutoryEsi: false,
  }));
}
async function approve(tenant: string, runId: string) {
  const ctx: RequestContext = { tenantId: tenant, actorId: approver, actorType: "user", roles: ["super_admin"], correlationId: randomUUID() };
  await runWithTenant(tenant, () => approveRun(ctx, runId));
  await memQueue.drain();
}
const setFlag = (tenant: string, on: boolean) => q(tenant, sql`INSERT INTO payroll.payroll_settings (tenant_id, project_costing_enabled)
  VALUES (${tenant}::uuid, ${on}) ON CONFLICT (tenant_id) DO UPDATE SET project_costing_enabled = ${on}`);
const allocate = (tenant: string, employeeId: string, projectId: string, cc: string, pct: number) => q(tenant, sql`
  INSERT INTO payroll.employee_cost_allocations (tenant_id, employee_id, target_type, project_id, cost_center_id, split_pct, effective_from, status, requested_by, decided_by, decided_at)
  VALUES (${tenant}::uuid, ${employeeId}::uuid, 'project', ${projectId}::uuid, ${cc}::uuid, ${pct}, '2026-01-01', 'active', ${creator}::uuid, ${approver}::uuid, now())`);

describe("run approval -> project cost lines", () => {
  it("flag OFF (the default): approving a run writes no cost lines and no project posting", async () => {
    const tenant = randomUUID(); const e = randomUUID();
    const runId = await newRun(tenant, "2026-08");
    await addSlip(tenant, runId, e, "G7-OFF", R(50000));
    await approve(tenant, runId);
    expect((await q<{ status: string }>(tenant, sql`SELECT status FROM payroll.payroll_runs WHERE id = ${runId}::uuid`))[0]!.status).toBe("approved");
    expect(await q(tenant, sql`SELECT 1 FROM payroll.slip_cost_lines`)).toHaveLength(0);
    expect(await q(tenant, sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = ${EVENTS.projectCostPosted}`)).toHaveLength(0);
  });

  it("flag ON: lines tie to the slips and to the GL accrual's employer figure", async () => {
    const tenant = randomUUID(); const e1 = randomUUID(); const e2 = randomUUID();
    await setFlag(tenant, true);
    await allocate(tenant, e1, P1, CC1, 70.5);
    await allocate(tenant, e1, P2, CC2, 29.5);
    const runId = await newRun(tenant, "2026-08");
    await addSlip(tenant, runId, e1, "G7-E1", R(50000));
    await addSlip(tenant, runId, e2, "G7-E2", R(32000)); // no allocation -> unallocated
    await approve(tenant, runId);

    const slips = await q<{ gross: string }>(tenant, sql`SELECT COALESCE(sum(gross_minor),0)::text AS gross FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid`);
    const lines = await q<Record<string, string>>(tenant, sql`SELECT employee_id, target_type, project_id, gross_minor::text AS gross,
      (employer_pf_minor + employer_esi_minor + employer_nps_minor)::text AS employer, other_employer_minor::text AS other, total_cost_minor::text AS total
      FROM payroll.slip_cost_lines WHERE run_id = ${runId}::uuid`);
    const sum = (k: string, f: (l: Record<string, string>) => boolean = () => true) => lines.filter(f).reduce((s, l) => s + BigInt(l[k]!), 0n);
    expect(sum("gross")).toBe(BigInt(slips[0]!.gross));
    expect(sum("gross", (l) => l.employee_id === e1 && l.project_id === P1)).toBeGreaterThan(sum("gross", (l) => l.employee_id === e1 && l.project_id === P2));
    expect(lines.filter((l) => l.employee_id === e2).map((l) => l.target_type)).toEqual(["unallocated"]);

    const ev = await q<{ payload: { totalGrossMinor: string; totalEmployerContribMinor: string; edliMinor?: string; epfAdminMinor?: string; upsPoolMinor?: string } }>(
      tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = ${EVENTS.runApproved} AND payload->>${"runId"} = ${runId}`);
    const gl = ev[0]!.payload;
    expect(sum("gross")).toBe(BigInt(gl.totalGrossMinor));
    // employer contributions (PF + ESI + NPS) match the GL accrual; EDLI / admin / UPS pool are the "other" component
    expect(sum("employer")).toBe(BigInt(gl.totalEmployerContribMinor));
    expect(sum("other")).toBe(BigInt(gl.edliMinor ?? 0) + BigInt(gl.epfAdminMinor ?? 0) + BigInt(gl.upsPoolMinor ?? 0));
    // project totals were published without any employee identity
    const posted = await q<{ payload: unknown }>(tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = ${EVENTS.projectCostPosted}`);
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted[0]!.payload)).not.toMatch(new RegExp(`${e1}|${e2}|employee`, "i"));
  });

  it("a costing failure never blocks the salary approval: it is audited and can be redone", async () => {
    const tenant = randomUUID(); const e = randomUUID();
    await setFlag(tenant, true);
    // two active 100% lines for the same employee: impossible through the API, forces splitSlipCost to throw
    await allocate(tenant, e, P1, CC1, 100);
    await allocate(tenant, e, P2, CC2, 100);
    const runId = await newRun(tenant, "2026-08");
    await addSlip(tenant, runId, e, "G7-BAD", R(40000));
    await approve(tenant, runId);
    expect((await q<{ status: string }>(tenant, sql`SELECT status FROM payroll.payroll_runs WHERE id = ${runId}::uuid`))[0]!.status).toBe("approved");
    expect(await q(tenant, sql`SELECT 1 FROM payroll.slip_cost_lines`)).toHaveLength(0);
    expect(await q(tenant, sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = ${"audit.event.record"} AND payload->>${"action"} = ${"project_cost_failed"}`)).toHaveLength(1);
    expect(await q(tenant, sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = ${EVENTS.runApproved} AND payload->>${"runId"} = ${runId}`)).toHaveLength(1);
  });
});
