/**
 * PR #2454 delta review BLOCKER: sending a computed run back must DELETE the
 * due-minus-drawn arrears (source revision_dmd) the pass generated, not release
 * them. Released, the next pass counted the stale row as already raised, priced
 * only the difference and lost that insert to the unique key (ON CONFLICT DO
 * NOTHING), so a revision corrected after the send-back was paid at the stale
 * amount (reviewer probe: Rs 3,700 kept, Rs 7,400 due).
 *
 * Real DB, real consumers, end to end. For each correction (the revision, then
 * separately the DA rate) a tenant computes, sends back, corrects and
 * recomputes; a control tenant computes once with the corrected data from the
 * start. The recomputed arrears must equal the control exactly, be raised once
 * and be paid by the new run.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/payroll/repo.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = randomUUID();
const ADMIN = randomUUID();
const RUN_MONTH = "2026-09";
const R = (rupees: number): bigint => BigInt(rupees) * 100n;

type Emp = { id: string; employeeNo: string; fullName: string; basicMinor: string; dateOfJoining: string; payStructureId: null; bankAccountNo: null; bankIfsc: null; pan: null; uan: null; cityClass: "X"; taxRegime: "new"; departmentId: string; pensionScheme: "NPS"; stateCode: string };
const feed = new Map<string, Emp>();

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(async (tenant: string, month: string) => ({ month, employees: [feed.get(tenant)!], lopDays: {} })) };
});

afterAll(async () => { await sqlClient.end(); });

const inTenant = <T>(tenant: string, fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
const q = async <T>(tenant: string, query: ReturnType<typeof sql>) => Array.from((await inTenant(tenant, (tx) => tx.execute(query))) as unknown as Iterable<T>);

type Setup = { newBasic: number; daRates: Array<[string, number]> };

/** A tenant whose employee drew August at the OLD basic 40,000 and has a revision effective 1-8-2026. */
async function seedTenant(s: Setup): Promise<{ tenant: string; emp: string; revisionId: string }> {
  const tenant = randomUUID();
  const emp = randomUUID();
  const revisionId = randomUUID();
  feed.set(tenant, {
    id: emp, employeeNo: "E-DMD", fullName: "Arrears Employee", basicMinor: R(s.newBasic).toString(), dateOfJoining: "2020-01-01",
    payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: null, cityClass: "X", taxRegime: "new",
    departmentId: randomUUID(), pensionScheme: "NPS", stateCode: "KA",
  });
  await inTenant(tenant, async (tx) => {
    for (const [from, bps] of s.daRates) {
      await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, ${from}::date, ${bps})`);
    }
    await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor) VALUES (${tenant}::uuid, ${"KA"}, 0, 999999999999, 20000)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_salary_revisions (id, tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, status)
      VALUES (${revisionId}::uuid, ${tenant}::uuid, ${emp}::uuid, ${"2026-08-01"}::date, ${R(40000).toString()}::bigint, ${R(s.newBasic).toString()}::bigint, 0, 0, ${"approved"})`);
    // August drawn at the old basic (40,000 + DA 58% + HRA), in a disbursed run.
    const drawnRun = randomUUID();
    await repo.insertRun(tx as never, {
      id: drawnRun, tenantId: tenant, runNo: `DRAWN-${drawnRun.slice(0, 6)}`, month: "2026-08", departmentId: null,
      structureId: randomUUID(), runType: "regular", ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n,
      currency: "INR", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
    });
    const gross = R(40000 + 23200 + 9600);
    await repo.insertSlip(tx as never, {
      id: randomUUID(), tenantId: tenant, runId: drawnRun, employeeId: emp, employeeNo: "E-DMD",
      basicMinor: R(40000), grossMinor: gross, totalDeductionsMinor: 0n, netPayMinor: gross, currency: "INR",
      components: [
        { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 40000 * 100 },
        { code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: 23200 * 100 },
        { code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: 9600 * 100 },
      ],
      status: "computed", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  return { tenant, emp, revisionId };
}

type Dmd = { from_period: string; component_code: string; difference_minor: string; pension_base_minor: string | null; status: string; run_id: string | null };
const dmdRows = (tenant: string) => q<Dmd>(tenant, sql`
  SELECT from_period, component_code, difference_minor::text, pension_base_minor::text, status, run_id::text
    FROM payroll.payroll_arrears WHERE source = ${"revision_dmd"} AND settled_in_period = ${RUN_MONTH}
   ORDER BY from_period, component_code`);
const shape = (rows: Dmd[]) => rows.map((r) => [r.from_period, r.component_code, r.difference_minor, r.pension_base_minor]);
const slipArrear = async (tenant: string, runId: string) => {
  const s = await q<{ components: Array<{ code: string; amountMinor: number }> }>(tenant, sql`SELECT components FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid`);
  return s[0]!.components.filter((c) => c.code.startsWith("ARREAR")).map((c) => [c.code, c.amountMinor]);
};

function harness() {
  const queue = new MemoryQueue();
  registerPayrollConsumers(queue);
  const publish = async (tenant: string, topic: string, payload: Record<string, unknown>, actorId = ACTOR) => {
    await queue.publish(topic, { messageId: randomUUID(), type: topic, tenantId: tenant, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: tenant, ...payload } });
    await queue.drain();
    expect(queue.dlq, JSON.stringify(queue.dlq)).toHaveLength(0);
  };
  const compute = async (tenant: string) => {
    const runId = randomUUID();
    await publish(tenant, COMMANDS.runCreate, { id: runId, runNo: `RUN-DMD-${runId.slice(0, 8)}`, month: RUN_MONTH });
    const st = await q<{ status: string }>(tenant, sql`SELECT status FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    expect(st[0]?.status).toBe("computed");
    return runId;
  };
  const sendBack = (tenant: string, runId: string) => publish(tenant, COMMANDS.runReject, { id: runId, rejectedBy: ADMIN, reason: "revision / DA corrected, recompute" }, ADMIN);
  return { compute, sendBack };
}

async function rejectAudit(tenant: string, runId: string) {
  const rows = await q<{ payload: { arrearsDeleted: Array<{ differenceMinor: string; source: string }>; counts: Record<string, number> } }>(tenant, sql`
    SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${runId} AND payload->>${"action"} = ${"reject"}`);
  return rows[0]?.payload;
}

describe("send back + corrected revision / DA: arrears are re-derived, raised once (PR #2454 delta review)", () => {
  it("a revision corrected after the send-back is paid at the corrected amount", async () => {
    const h = harness();
    const stale = await seedTenant({ newBasic: 42000, daRates: [["2025-07-01", 5800]] });
    const r1 = await h.compute(stale.tenant);
    const first = await dmdRows(stale.tenant);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((r) => r.run_id === r1 && r.status === "paid")).toBe(true);

    await h.sendBack(stale.tenant, r1);
    expect(await dmdRows(stale.tenant)).toEqual([]); // deleted, not released
    const audit = await rejectAudit(stale.tenant, r1);
    expect(audit?.counts.arrearsDeleted).toBe(first.length);
    expect(audit?.arrearsDeleted.map((a) => a.differenceMinor).sort()).toEqual(first.map((r) => r.difference_minor).sort());

    // The revision is corrected: 40,000 -> 44,000 (HRMS basic too).
    await inTenant(stale.tenant, (tx) => tx.execute(sql`UPDATE payroll.payroll_salary_revisions SET new_basic_minor = ${R(44000).toString()}::bigint WHERE id = ${stale.revisionId}::uuid`));
    feed.get(stale.tenant)!.basicMinor = R(44000).toString();
    const r2 = await h.compute(stale.tenant);

    const control = await seedTenant({ newBasic: 44000, daRates: [["2025-07-01", 5800]] });
    const c1 = await h.compute(control.tenant);
    const expected = await dmdRows(control.tenant);

    const got = await dmdRows(stale.tenant);
    expect(shape(got)).toEqual(shape(expected));
    expect(shape(got)).not.toEqual(shape(first)); // the correction is really priced
    expect(got.every((r) => r.run_id === r2 && r.status === "paid")).toBe(true); // raised once, paid by R2
    expect(await slipArrear(stale.tenant, r2)).toEqual(await slipArrear(control.tenant, c1));
  });

  it("a DA rate corrected after the send-back is paid at the corrected amount", async () => {
    const h = harness();
    const stale = await seedTenant({ newBasic: 42000, daRates: [["2025-07-01", 5800]] });
    const r1 = await h.compute(stale.tenant);
    const first = await dmdRows(stale.tenant);
    expect(first.length).toBeGreaterThan(0);
    await h.sendBack(stale.tenant, r1);
    expect(await dmdRows(stale.tenant)).toEqual([]);

    // The DA rate for August onwards is corrected to 60%.
    await inTenant(stale.tenant, (tx) => tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${stale.tenant}::uuid, ${"2026-08-01"}::date, 6000)`));
    const r2 = await h.compute(stale.tenant);

    const control = await seedTenant({ newBasic: 42000, daRates: [["2025-07-01", 5800], ["2026-08-01", 6000]] });
    const c1 = await h.compute(control.tenant);
    const expected = await dmdRows(control.tenant);

    const got = await dmdRows(stale.tenant);
    expect(shape(got)).toEqual(shape(expected));
    expect(shape(got)).not.toEqual(shape(first));
    expect(got.every((r) => r.run_id === r2 && r.status === "paid")).toBe(true);
    expect(await slipArrear(stale.tenant, r2)).toEqual(await slipArrear(control.tenant, c1));
  });
});
