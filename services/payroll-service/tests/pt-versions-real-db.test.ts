/**
 * GAP-PAYROLL-STATUTORY-PT-04 (remainder): effective-dated professional-tax
 * slab versions, end to end against a REAL Postgres (migrated through 0078,
 * FORCE RLS, non-superuser payroll_svc), through buildApp() and the real
 * consumers: a run uses the version in force on its period end, back-dating is
 * refused before the latest finalised run, the Article 276(2) Rs 2,500 annual
 * cap holds, the February amount applies, concurrent creation is race-safe,
 * and past versions cannot be changed.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn(async () => new Map()) };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers, resolvePtSlabs } from "../src/modules/payroll/consumer.js";
import { readFileSync } from "node:fs";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const DEPT = randomUUID();
const ADMIN = ["payroll_admin"];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;
const CHECKER = randomUUID();
const CHECKER_2 = randomUUID();
const hdrAs = (tenant: string, actor: string, roles = ADMIN) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: "pt" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
const hdr = (tenant: string, roles = ADMIN) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "pt" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
const asTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>) => runWithTenant(tenant, () => db.transaction(fn));
const q = async (tenant: string, s: ReturnType<typeof sql>) => (await asTenant(tenant, (tx) => tx.execute(s))) as unknown as Row[];
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 60)); v = await fn(); }
  return v;
}

let app: FastifyInstance;
const tenants: string[] = [];

/** A tenant with a DA rate, a structure, and (optionally) a legacy, header-less slab set. */
/** `makerChecker` false (the default here) = the tenant switch is OFF, so the legacy-style single-admin tests apply versions at once. */
async function newTenant(state: string, slabs: Array<{ from: number; to: number; amt: number; feb?: number }>, makerChecker = false): Promise<{ tenant: string; structure: string }> {
  const tenant = randomUUID();
  const structure = randomUUID();
  tenants.push(tenant);
  await asTenant(tenant, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, '2020-01-01', 5000)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${structure}::uuid, ${tenant}::uuid, 'PT', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    if (!makerChecker) {
      await tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, pt_version_maker_checker) VALUES (${tenant}::uuid, FALSE)`);
    }
    for (const s of slabs) {
      await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, february_amount_minor, effective_from)
        VALUES (${tenant}::uuid, ${state}, ${s.from}, ${s.to}, ${s.amt}, ${s.feb ?? null}, '1900-01-01')`);
    }
  });
  return { tenant, structure };
}

const employee = (id: string, state: string) => ({
  id, employeeNo: `E-${id.slice(0, 6)}`, fullName: "PT Tester", basicMinor: "2000000", dateOfJoining: "2015-01-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: false, statutoryNps: true, stateCode: state,
});

async function runMonth(tenant: string, structure: string, month: string, emps: ReturnType<typeof employee>[]): Promise<string> {
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month, employees: emps, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(tenant), payload: { runNo: `PT-${month}-${randomUUID().slice(0, 4)}`, month, structureId: structure } });
  expect([201, 202]).toContain(res.statusCode);
  const runId = (res.json().data?.id ?? res.json().id) as string;
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 200));
    const [run] = await q(tenant, sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(tenant, sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed") throw new Error(`run failed: ${String(run.last_error)}`);
    if (regs.length > 0) return runId;
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}

const ptOf = async (tenant: string, runId: string, employeeId: string): Promise<number> => {
  const [s] = await q(tenant, sql`SELECT components FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid AND employee_id = ${employeeId}::uuid`);
  return (s!.components as Array<{ code: string; amountMinor: number }>).find((c) => c.code === "PT")?.amountMinor ?? 0;
};

/** A finalised run + slip carrying `ptMinor` of PT, to build a financial-year history. */
async function seedFinalised(tenant: string, structure: string, employeeId: string, month: string, ptMinor: number): Promise<void> {
  const runId = randomUUID();
  await asTenant(tenant, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
      VALUES (${runId}::uuid, ${tenant}::uuid, ${`SEED-${month}`}, ${month}, ${structure}::uuid, 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, components, created_by, updated_by)
      VALUES (${tenant}::uuid, ${runId}::uuid, ${employeeId}::uuid, 'SEED', ${JSON.stringify([{ code: "PT", name: "Professional Tax", type: "deduction", amountMinor: ptMinor }])}::jsonb, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
}

const createVersion = (tenant: string, body: Record<string, unknown>, roles = ADMIN) =>
  app.inject({ method: "POST", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant, roles), payload: body });
const versionsOf = async (tenant: string, state: string): Promise<Row[]> =>
  q(tenant, sql`SELECT effective_from::text AS eff, slab_from_minor::text AS f, pt_amount_minor::text AS amt FROM payroll.payroll_professional_tax WHERE state_code = ${state} ORDER BY effective_from, slab_from_minor`);

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  // Slab / version rows are immutable by design (0077), so the fixtures stay; the
  // run-side rows are tenant-scoped test data under random tenant ids.
  for (const t of tenants) {
    await asTenant(t, async (tx) => {
      for (const tbl of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps",
        "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_runs", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
        await tx.execute(sql.raw(`DELETE FROM ${tbl} WHERE tenant_id = '${t}'`));
      }
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("a run uses the version in force on its period end", () => {
  it("old version before the effective date, new version from it", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const emp = randomUUID();

    const created = await createVersion(tenant, {
      stateCode: "MH", effectiveFrom: "2027-01-01", reason: "Schedule revised by the State (test)",
      slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 25000 }],
    });
    expect(created.statusCode).toBe(202);
    await until(() => versionsOf(tenant, "MH"), (r) => r.length === 2);

    // 2026-12 period ends 2026-12-31 < 2027-01-01 -> the old slab; 2027-01 -> the new one.
    const before = await runMonth(tenant, structure, "2026-12", [employee(emp, "MH")]);
    const after = await runMonth(tenant, structure, "2027-01", [employee(emp, "MH")]);
    expect(await ptOf(tenant, before, emp)).toBe(20000);
    expect(await ptOf(tenant, after, emp)).toBe(25000);

    const list = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions?stateCode=MH", headers: hdr(tenant, ["hr_admin"]) });
    expect(list.statusCode).toBe(200);
    const mh = (list.json() as { states: Array<{ stateCode: string; versions: Array<{ effectiveFrom: string; effectiveTo: string | null; legacy: boolean }> }> }).states[0]!;
    expect(mh.versions.map((v) => [v.effectiveFrom, v.effectiveTo, v.legacy])).toEqual([
      ["1900-01-01", "2026-12-31", true],
      ["2027-01-01", null, false],
    ]);
  }, 90_000);

  it("a state with no version in force pays no PT (never another state's slabs)", async () => {
    const { tenant, structure } = await newTenant("KA", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const emp = randomUUID();
    const run = await runMonth(tenant, structure, "2026-05", [employee(emp, "GJ")]);
    expect(await ptOf(tenant, run, emp)).toBe(0);
  }, 60_000);
});

describe("back-dating", () => {
  it("is refused on or before the end of the latest finalised run's month", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const emp = randomUUID();
    const run = await runMonth(tenant, structure, "2026-11", [employee(emp, "MH")]);
    await q(tenant, sql`UPDATE payroll.payroll_runs SET status = 'approved' WHERE id = ${run}::uuid`);

    for (const effectiveFrom of ["2026-11-15", "2026-11-30", "2026-06-01"]) {
      const r = await createVersion(tenant, { stateCode: "MH", effectiveFrom, reason: "Correcting an earlier period", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 25000 }] });
      expect(r.statusCode, effectiveFrom).toBe(409);
      expect((r.json() as { code: string }).code).toBe("PT_BACKDATE_BEFORE_FINALISED_RUN");
    }
    // The day after the month is fine (needs a reason only while it is in the past).
    const ok = await createVersion(tenant, { stateCode: "MH", effectiveFrom: "2026-12-01", reason: "Revised schedule effective December", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 25000 }] });
    expect(ok.statusCode).toBe(202);
    await until(() => versionsOf(tenant, "MH"), (r) => r.length === 2);
    // the finalised run's own slip is untouched
    expect(await ptOf(tenant, run, emp)).toBe(20000);
  }, 90_000);

  it("a back-dated version needs a reason, which is recorded and audited", async () => {
    const { tenant } = await newTenant("RJ", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const body = { stateCode: "RJ", effectiveFrom: "2020-04-01", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 15000 }] };
    const noReason = await createVersion(tenant, body);
    expect(noReason.statusCode).toBe(422);
    expect((noReason.json() as { code: string }).code).toBe("PT_BACKDATE_REASON_REQUIRED");

    const ok = await createVersion(tenant, { ...body, reason: "Notification received late from the Commercial Taxes Dept" });
    expect(ok.statusCode).toBe(202);
    await until(() => versionsOf(tenant, "RJ"), (r) => r.length === 2);
    const [hdrRow] = await q(tenant, sql`SELECT back_dated, reason, source, created_by::text AS by FROM payroll.payroll_pt_slab_versions WHERE state_code = 'RJ' AND effective_from = '2020-04-01'`);
    expect(hdrRow).toMatchObject({ back_dated: true, source: "user", by: ACTOR });
    expect(hdrRow!.reason).toContain("Commercial Taxes");
    const audits = await until(() => q(tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' = 'RJ:2020-04-01'`), (r) => r.length > 0);
    expect(audits[0]!.payload).toMatchObject({ action: "create", outcome: "success", backDated: true });
    expect(String((audits[0]!.payload as { reason: string }).reason)).toContain("Commercial Taxes");
  }, 60_000);
});

describe("the outcome of a create command is visible to the caller", () => {
  const outcomeOf = async (tenant: string, id: string) =>
    (await app.inject({ method: "GET", url: `/v1/payroll/statutory/pt/versions/requests/${id}`, headers: hdr(tenant) })).json() as { status: string; code: string | null };

  it("202 carries a request id; with the switch OFF the outcome becomes applied once the version exists", async () => {
    const { tenant } = await newTenant("OD", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const r = await createVersion(tenant, { stateCode: "OD", effectiveFrom: "2099-07-01", reason: "Outcome visibility test", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 12000 }] });
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const done = await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending");
    expect(done).toMatchObject({ status: "applied", code: null });
    expect((await versionsOf(tenant, "OD")).filter((v) => v.eff === "2099-07-01")).toHaveLength(1);
  }, 60_000);

  it("a command that loses a race is reported as rejected, with its code, and writes nothing", async () => {
    const { tenant } = await newTenant("OD", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await queue.publish(COMMANDS.ptVersionCreate, {
        messageId: id, type: COMMANDS.ptVersionCreate, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { tenantId: tenant, stateCode: "OD", effectiveFrom: "2099-08-01", reason: "Race outcome test", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 12000 }] },
      });
    }
    const outs = await Promise.all(ids.map((id) => until(() => outcomeOf(tenant, id), (o) => o.status !== "pending")));
    expect(outs.map((o) => o.status).sort()).toEqual(["applied", "rejected"]);
    expect(outs.find((o) => o.status === "rejected")!.code).toBe("PT_VERSION_EXISTS");
    expect((await versionsOf(tenant, "OD")).filter((v) => v.eff === "2099-08-01")).toHaveLength(1);
  }, 60_000);

  it("an unknown id is pending; another tenant's id is never revealed", async () => {
    const { tenant } = await newTenant("OD", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const other = await newTenant("OD", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const r = await createVersion(tenant, { stateCode: "OD", effectiveFrom: "2099-09-01", reason: "Tenant isolation test", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 12000 }] });
    const id = (r.json() as { id: string }).id;
    await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending");
    expect((await outcomeOf(other.tenant, id)).status).toBe("pending");
    expect((await outcomeOf(tenant, randomUUID())).status).toBe("pending");
  }, 60_000);

  it("the duplicate check also sees dates held only by slab rows with no header", async () => {
    // newTenant inserts a header-less (legacy) set at 1900-01-01: still taken.
    const { tenant } = await newTenant("OD", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const id = randomUUID();
    await queue.publish(COMMANDS.ptVersionCreate, {
      messageId: id, type: COMMANDS.ptVersionCreate, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: tenant, stateCode: "OD", effectiveFrom: "1900-01-01", reason: "Duplicate of the baseline", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 1 }] },
    });
    expect(await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending")).toMatchObject({ status: "rejected", code: "PT_VERSION_EXISTS" });
  }, 60_000);
});

describe("maker != checker (tenant switch ON, the default)", () => {
  const slabs = [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 12000 }];
  const outcomeOf = async (tenant: string, id: string) =>
    (await app.inject({ method: "GET", url: `/v1/payroll/statutory/pt/versions/requests/${id}`, headers: hdr(tenant) })).json() as { status: string; code: string | null };
  const submit = async (tenant: string, state: string, effectiveFrom: string) => {
    const r = await createVersion(tenant, { stateCode: state, effectiveFrom, reason: "Maker-checker test version", slabs });
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;
    expect(await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending")).toMatchObject({ status: "pending_approval" });
    return id;
  };
  const decide = (tenant: string, actor: string, id: string, what: "approve" | "reject", roles = ADMIN) =>
    app.inject({ method: "PATCH", url: `/v1/payroll/statutory/pt/versions/requests/${id}/${what}`, headers: hdrAs(tenant, actor, roles), payload: { note: "Checked against the Act" } });
  const publishDecision = (tenant: string, actor: string, id: string, decision: "approved" | "rejected") => queue.publish(COMMANDS.ptVersionDecide, {
    messageId: randomUUID(), type: COMMANDS.ptVersionDecide, tenantId: tenant, actorId: actor, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { tenantId: tenant, id, decision, note: null },
  });

  it("a new version is only a PENDING request: nothing is written and no run can use it", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    await submit(tenant, "MH", "2099-01-01");
    expect(await versionsOf(tenant, "MH")).toHaveLength(1);
    const list = (await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant, ["hr_admin"]) })).json() as { makerChecker: boolean; pending: Array<{ kind: string; stateCode: string; makerId: string }> };
    expect(list.makerChecker).toBe(true);
    expect(list.pending).toHaveLength(1);
    expect(list.pending[0]).toMatchObject({ kind: "version", stateCode: "MH", makerId: ACTOR });
  }, 60_000);

  it("self-approval is refused (403 at the route; a command that bypasses it changes nothing)", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const id = await submit(tenant, "MH", "2099-02-01");
    const r = await decide(tenant, ACTOR, id, "approve");
    expect(r.statusCode).toBe(403);
    expect((r.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN");
    await publishDecision(tenant, ACTOR, id, "approved"); // straight at the consumer
    await new Promise((res) => setTimeout(res, 600));
    expect(await outcomeOf(tenant, id)).toMatchObject({ status: "pending_approval" });
    expect(await versionsOf(tenant, "MH")).toHaveLength(1);
  }, 60_000);

  it("a DIFFERENT administrator approves: the version is written (approved_by recorded) and audited; a second decision is 409", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const id = await submit(tenant, "MH", "2099-03-01");
    expect((await decide(tenant, CHECKER, id, "approve", ["payroll_officer"])).statusCode).toBe(403); // role gate
    const ok = await decide(tenant, CHECKER, id, "approve");
    expect(ok.statusCode).toBe(202);
    expect(await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending_approval")).toMatchObject({ status: "applied" });
    expect((await versionsOf(tenant, "MH")).filter((v) => v.eff === "2099-03-01")).toHaveLength(1);
    const [h] = await q(tenant, sql`SELECT created_by::text AS maker, approved_by::text AS approver FROM payroll.payroll_pt_slab_versions WHERE state_code = 'MH' AND effective_from = '2099-03-01'`);
    expect(h).toMatchObject({ maker: ACTOR, approver: CHECKER });
    const audits = await q(tenant, sql`SELECT actor_id::text AS actor, payload->>'action' AS action FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' = 'MH:2099-03-01' ORDER BY created_at`);
    expect(audits.map((a) => [a.action, a.actor])).toEqual([["submit", ACTOR], ["approve", CHECKER]]);
    expect((await decide(tenant, CHECKER_2, id, "approve")).statusCode).toBe(409);
  }, 60_000);

  it("a rejection leaves nothing behind and is reported as declined", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const id = await submit(tenant, "MH", "2099-04-01");
    expect((await decide(tenant, CHECKER, id, "reject")).statusCode).toBe(202);
    expect(await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending_approval")).toMatchObject({ status: "declined" });
    expect(await versionsOf(tenant, "MH")).toHaveLength(1);
  }, 60_000);

  it("two concurrent decisions by different approvers: exactly one wins, the version is written once", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const id = await submit(tenant, "MH", "2099-05-01");
    await Promise.all([publishDecision(tenant, CHECKER, id, "approved"), publishDecision(tenant, CHECKER_2, id, "approved"), publishDecision(tenant, CHECKER, id, "rejected")]);
    await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending_approval");
    await new Promise((res) => setTimeout(res, 800));
    const status = (await outcomeOf(tenant, id)).status;
    expect(["applied", "declined"]).toContain(status);
    expect((await versionsOf(tenant, "MH")).filter((v) => v.eff === "2099-05-01")).toHaveLength(status === "applied" ? 1 : 0);
    const decisions = await q(tenant, sql`SELECT payload->>'action' AS action FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' IN ('MH:2099-05-01', ${id})`);
    expect(decisions.filter((d) => d.action === "approve" || d.action === "reject")).toHaveLength(1);
    expect(decisions.filter((d) => d.action === "decision_ignored")).toHaveLength(2);
  }, 60_000);

  it("rules are re-run at approval: a date taken meanwhile is rejected (PT_VERSION_EXISTS), nothing written", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const id = await submit(tenant, "MH", "2099-06-01");
    // another set lands on that date while the request waits
    await asTenant(tenant, (tx) => tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, effective_from)
      VALUES (${tenant}::uuid, 'MH', 0, 999999999999, 777, '2099-06-01')`));
    expect((await decide(tenant, CHECKER, id, "approve")).statusCode).toBe(202);
    expect(await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending_approval")).toMatchObject({ status: "rejected", code: "PT_VERSION_EXISTS" });
    expect((await versionsOf(tenant, "MH")).filter((v) => v.eff === "2099-06-01").map((v) => v.amt)).toEqual(["777"]);
  }, 60_000);

  it("rules are re-run at approval: a run finalised past the date meanwhile is rejected (PT_BACKDATE_BEFORE_FINALISED_RUN)", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const id = await submit(tenant, "MH", "2099-07-01");
    await seedFinalised(tenant, structure, randomUUID(), "2099-08", 0);
    expect((await decide(tenant, CHECKER, id, "approve")).statusCode).toBe(202);
    expect(await until(() => outcomeOf(tenant, id), (o) => o.status !== "pending_approval")).toMatchObject({ status: "rejected", code: "PT_BACKDATE_BEFORE_FINALISED_RUN" });
    expect((await versionsOf(tenant, "MH")).filter((v) => v.eff === "2099-07-01")).toHaveLength(0);
  }, 60_000);

  it("turning the switch OFF is itself a request a DIFFERENT administrator must approve; ON is immediate", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const put = (actor: string, body: Record<string, unknown>) => app.inject({ method: "PUT", url: "/v1/payroll/statutory/pt/settings", headers: hdrAs(tenant, actor), payload: body });
    expect((await put(ACTOR, { makerCheckerEnabled: false })).statusCode).toBe(422); // reason required
    const off = await put(ACTOR, { makerCheckerEnabled: false, reason: "Single-officer office; reviewed by the DDO" });
    expect(off.statusCode).toBe(202);
    const reqId = (off.json() as { id: string }).id;
    expect(await until(() => outcomeOf(tenant, reqId), (o) => o.status !== "pending")).toMatchObject({ status: "pending_approval" });
    const stillOn = (await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant) })).json() as { makerChecker: boolean; pending: Array<{ kind: string }> };
    expect(stillOn.makerChecker).toBe(true);
    expect(stillOn.pending.map((x) => x.kind)).toEqual(["checker_off"]);

    expect((await decide(tenant, ACTOR, reqId, "approve")).statusCode).toBe(403); // not by its maker
    // a second "turn off" request while one is pending creates no second row
    await put(ACTOR, { makerCheckerEnabled: false, reason: "Asking again while it is pending" });
    await new Promise((res) => setTimeout(res, 500));
    expect((await q(tenant, sql`SELECT 1 FROM payroll.payroll_pt_version_requests WHERE kind = 'checker_off' AND status = 'pending_approval'`))).toHaveLength(1);

    expect((await decide(tenant, CHECKER, reqId, "approve")).statusCode).toBe(202);
    await until(() => outcomeOf(tenant, reqId), (o) => o.status !== "pending_approval");
    const nowOff = (await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant) })).json() as { makerChecker: boolean };
    expect(nowOff.makerChecker).toBe(false);

    // with the switch off a version applies at once
    const v = await createVersion(tenant, { stateCode: "MH", effectiveFrom: "2099-09-01", reason: "Applies at once now", slabs });
    expect(await until(() => outcomeOf(tenant, (v.json() as { id: string }).id), (o) => o.status !== "pending")).toMatchObject({ status: "applied" });

    // ON again is immediate and needs no approval
    expect((await put(ACTOR, { makerCheckerEnabled: true })).statusCode).toBe(202);
    const back = await until(async () => (await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant) })).json() as { makerChecker: boolean }, (x) => x.makerChecker);
    expect(back.makerChecker).toBe(true);
  }, 90_000);
});

describe("switch ON again cancels a pending turn-off request", () => {
  it("a later approval of the cancelled request changes nothing; pending versions stay pending when the switch goes OFF", async () => {
    const { tenant } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 10000 }], true);
    const put = (actor: string, body: Record<string, unknown>) => app.inject({ method: "PUT", url: "/v1/payroll/statutory/pt/settings", headers: hdrAs(tenant, actor), payload: body });
    const outcome = async (id: string) => (await app.inject({ method: "GET", url: `/v1/payroll/statutory/pt/versions/requests/${id}`, headers: hdr(tenant) })).json() as { status: string; decidedByViewer?: boolean };
    const state = async () => (await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant) })).json() as { makerChecker: boolean; pending: Array<{ kind: string }> };

    const v = await createVersion(tenant, { stateCode: "MH", effectiveFrom: "2099-10-01", reason: "Pending across the switch", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 12000 }] });
    const vId = (v.json() as { id: string }).id;
    await until(() => outcome(vId), (o) => o.status !== "pending");

    const off = await put(ACTOR, { makerCheckerEnabled: false, reason: "Single-officer office; reviewed" });
    const offId = (off.json() as { id: string }).id;
    await until(() => outcome(offId), (o) => o.status !== "pending");
    expect((await state()).pending.map((x) => x.kind).sort()).toEqual(["checker_off", "version"]);

    // switch back ON while the turn-off is pending: it is withdrawn (audited)
    expect((await put(ACTOR, { makerCheckerEnabled: true })).statusCode).toBe(202);
    expect(await until(() => outcome(offId), (o) => o.status === "cancelled")).toMatchObject({ status: "cancelled" });
    expect((await state()).makerChecker).toBe(true);
    expect((await state()).pending.map((x) => x.kind)).toEqual(["version"]);
    const audits = await q(tenant, sql`SELECT payload->>'action' AS action FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' = ${tenant}`);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["setting_off_requested", "setting_off_cancelled"]));

    // approving the cancelled request: 409 at the route; straight at the consumer it is ignored and the switch stays ON
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/statutory/pt/versions/requests/${offId}/approve`, headers: hdrAs(tenant, CHECKER), payload: {} })).statusCode).toBe(409);
    await queue.publish(COMMANDS.ptVersionDecide, {
      messageId: randomUUID(), type: COMMANDS.ptVersionDecide, tenantId: tenant, actorId: CHECKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: tenant, id: offId, decision: "approved", note: null },
    });
    await new Promise((res) => setTimeout(res, 600));
    expect((await state()).makerChecker).toBe(true);

    // a decision made by someone else is reported as such to the other would-be decider
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/statutory/pt/versions/requests/${vId}/approve`, headers: hdrAs(tenant, CHECKER), payload: {} })).statusCode).toBe(202);
    await until(() => outcome(vId), (o) => o.status !== "pending_approval");
    const asOther = await app.inject({ method: "GET", url: `/v1/payroll/statutory/pt/versions/requests/${vId}`, headers: hdrAs(tenant, CHECKER_2) });
    expect(asOther.json()).toMatchObject({ status: "applied", decidedByViewer: false });
    const asDecider = await app.inject({ method: "GET", url: `/v1/payroll/statutory/pt/versions/requests/${vId}`, headers: hdrAs(tenant, CHECKER) });
    expect(asDecider.json()).toMatchObject({ status: "applied", decidedByViewer: true });
  }, 90_000);
});

describe("0076 backfill of legacy slabs with mixed effective dates", () => {
  it("collapses each (tenant, state) into ONE 1900-01-01 version, keeps every slab, records the old dates, and resolves identically", async () => {
    const tenant = randomUUID();
    tenants.push(tenant);
    const rows = [
      { state: "GJ", from: 0, to: 1200000, amt: 0, eff: "2024-04-01" },
      { state: "GJ", from: 1200001, to: 999999999999, amt: 20000, eff: "2026-04-01" },
      { state: "TN", from: 0, to: 999999999999, amt: 15000, eff: "2025-04-01" },
    ];
    await asTenant(tenant, async (tx) => {
      for (const r of rows) {
        await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, effective_from)
          VALUES (${tenant}::uuid, ${r.state}, ${r.from}, ${r.to}, ${r.amt}, ${r.eff})`);
      }
    });
    // What the pre-versioning engine applied: every active slab of the state, dates ignored.
    const before = (await q(tenant, sql`SELECT state_code, slab_from_minor::text AS f, slab_to_minor::text AS t, pt_amount_minor::text AS a FROM payroll.payroll_professional_tax ORDER BY 1, slab_from_minor`));

    // Re-run the migration's backfill block (the immutability trigger did not exist when 0076 first ran).
    const sqlText = readFileSync(new URL("../migrations/0076_pt_slab_versions.sql", import.meta.url), "utf8");
    // Scoped to this test's tenant so other tenants' rows (and parallel test files) are untouched.
    const marker = "WHERE NOT EXISTS (SELECT 1 FROM payroll.payroll_pt_slab_versions v";
    const whole = sqlText.slice(sqlText.indexOf("-- Backfill (see header)"));
    expect(whole).toContain(marker);
    const block = whole.replace(marker, `WHERE pt.tenant_id = '${tenant}'::uuid AND NOT EXISTS (SELECT 1 FROM payroll.payroll_pt_slab_versions v`);
    await sqlClient.unsafe("ALTER TABLE payroll.payroll_professional_tax DISABLE TRIGGER trg_pt_slab_no_update");
    try { await sqlClient.unsafe(block); } finally { await sqlClient.unsafe("ALTER TABLE payroll.payroll_professional_tax ENABLE TRIGGER trg_pt_slab_no_update"); }

    const after = await q(tenant, sql`SELECT state_code, slab_from_minor::text AS f, slab_to_minor::text AS t, pt_amount_minor::text AS a, effective_from::text AS eff FROM payroll.payroll_professional_tax ORDER BY 1, slab_from_minor`);
    expect(after.map((r) => r.eff)).toEqual(["1900-01-01", "1900-01-01", "1900-01-01"]);
    expect(after.map(({ eff: _eff, ...rest }) => rest)).toEqual(before);

    const headers = await q(tenant, sql`SELECT state_code, effective_from::text AS eff, source, reason FROM payroll.payroll_pt_slab_versions ORDER BY state_code`);
    expect(headers.map((h) => [h.state_code, h.eff, h.source])).toEqual([["GJ", "1900-01-01", "migration"], ["TN", "1900-01-01", "migration"]]);
    expect(String(headers[0]!.reason)).toContain("2024-04-01,2026-04-01");

    // The engine resolves the same slab sets for any period (past or future), as before.
    for (const asOf of ["2020-01-01", "2026-10-03", "2099-01-01"]) {
      const gj = await asTenant(tenant, (tx) => resolvePtSlabs(tx as never, tenant, "GJ", asOf));
      expect(gj.map((x) => [x.from, x.to, x.amount])).toEqual([[0n, 1200000n, 0n], [1200001n, 999999999999n, 20000n]]);
    }

    // Idempotent: a second run changes nothing.
    await sqlClient.unsafe(block);
    expect(await q(tenant, sql`SELECT 1 FROM payroll.payroll_pt_slab_versions`)).toHaveLength(2);
  }, 60_000);
});

describe("immutability and access", () => {
  it("an existing effective date cannot be re-created, and stored versions cannot be updated or deleted", async () => {
    const { tenant } = await newTenant("TN", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const dup = await createVersion(tenant, { stateCode: "TN", effectiveFrom: "1900-01-01", reason: "Attempt to overwrite the baseline", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 99 }] });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { code: string }).code).toBe("PT_VERSION_EXISTS");
    await expect(q(tenant, sql`UPDATE payroll.payroll_professional_tax SET pt_amount_minor = 1 WHERE state_code = 'TN'`)).rejects.toThrow(/PT_VERSION_IMMUTABLE/);
    await expect(q(tenant, sql`DELETE FROM payroll.payroll_professional_tax WHERE state_code = 'TN'`)).rejects.toThrow(/PT_VERSION_IMMUTABLE/);
    expect((await versionsOf(tenant, "TN"))[0]).toMatchObject({ amt: "10000" });
  }, 60_000);

  it("only payroll_admin / super_admin create versions; bad input is refused", async () => {
    const { tenant } = await newTenant("GJ", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const slabs = [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 15000 }];
    for (const role of ["payroll_officer", "hr_admin", "finance_officer", "employee"]) {
      expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs }, [role])).statusCode, role).toBe(403);
    }
    expect((await createVersion(tenant, { stateCode: "ZZ", effectiveFrom: "2099-06-01", slabs })).statusCode).toBe(422);
    expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 0 }, { fromMinor: 50, toMinor: 200, taxMinor: 0 }] })).statusCode).toBe(422);
    // one month's PT can never exceed the annual cap
    expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 250001 }] })).statusCode).toBe(400);
    expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs }, ["super_admin"])).statusCode).toBe(202);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant, ["employee"]) })).statusCode).toBe(403);
  }, 60_000);
});

describe("Article 276(2): PT never exceeds Rs 2,500 per employee per financial year", () => {
  it("clamps this month's PT to what is left of the cap", async () => {
    // Rs 300 a month; 8 finalised months (Apr-Nov 2026) already deducted Rs 2,400 -> Rs 100 left.
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) await seedFinalised(tenant, structure, emp, m, 30000);
    const run = await runMonth(tenant, structure, "2026-12", [employee(emp, "MH")]);
    expect(await ptOf(tenant, run, emp)).toBe(10000);
  }, 60_000);

  it("is zero once the cap is reached", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) await seedFinalised(tenant, structure, emp, m, 30000);
    await seedFinalised(tenant, structure, emp, "2026-12", 10000); // = Rs 2,500 in total
    const capped = await runMonth(tenant, structure, "2027-01", [employee(emp, "MH")]);
    expect(await ptOf(tenant, capped, emp)).toBe(0);
  }, 90_000);

  it("the previous financial year's PT never counts against the new one", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    await seedFinalised(tenant, structure, emp, "2026-03", 250000); // FY 2025-26
    const run = await runMonth(tenant, structure, "2026-05", [employee(emp, "MH")]);
    expect(await ptOf(tenant, run, emp)).toBe(30000);
  }, 60_000);

  it("only finalised runs count towards the year-to-date", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    await seedFinalised(tenant, structure, emp, "2026-04", 250000);
    await q(tenant, sql`UPDATE payroll.payroll_runs SET status = 'failed' WHERE tenant_id = ${tenant}::uuid AND month = '2026-04'`);
    const run = await runMonth(tenant, structure, "2026-05", [employee(emp, "MH")]);
    expect(await ptOf(tenant, run, emp)).toBe(30000);
  }, 60_000);
});

describe("February amount (where a state's schedule has one)", () => {
  it("levies the February amount in February and the monthly amount otherwise, within the annual cap", async () => {
    // Rs 200 a month, Rs 300 in February (Rs 200 x 11 + Rs 300 = Rs 2,500).
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000, feb: 30000 }]);
    const emp = randomUUID();
    for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]) await seedFinalised(tenant, structure, emp, m, 20000);
    const feb = await runMonth(tenant, structure, "2027-02", [employee(emp, "MH")]);
    expect(await ptOf(tenant, feb, emp)).toBe(30000);
    const mar = await runMonth(tenant, structure, "2027-03", [employee(emp, "MH")]);
    expect(await ptOf(tenant, mar, emp)).toBe(20000);
  }, 90_000);
});

describe("concurrent creation is race-safe", () => {
  it("many commands for the same state + date create exactly one version", async () => {
    const { tenant } = await newTenant("KL", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const publish = (slabAmt: number) => queue.publish(COMMANDS.ptVersionCreate, {
      messageId: randomUUID(), type: COMMANDS.ptVersionCreate, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: tenant, stateCode: "KL", effectiveFrom: "2099-03-01", reason: "Concurrent creation test", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: slabAmt }] },
    });
    await Promise.all([15000, 16000, 17000, 18000, 19000, 20000].map(publish));
    const rows = await until(() => versionsOf(tenant, "KL"), (r) => r.length >= 2);
    await new Promise((r) => setTimeout(r, 800)); // let the losers drain
    const finalRows = await versionsOf(tenant, "KL");
    expect(finalRows.filter((r) => r.eff === "2099-03-01")).toHaveLength(1);
    expect(finalRows).toHaveLength(2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const headers = await q(tenant, sql`SELECT 1 FROM payroll.payroll_pt_slab_versions WHERE state_code = 'KL' AND effective_from = '2099-03-01'`);
    expect(headers).toHaveLength(1);
    const audits = await q(tenant, sql`SELECT payload->>'outcome' AS outcome FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' = 'KL:2099-03-01'`);
    expect(audits.filter((a) => a.outcome === "success")).toHaveLength(1);
    expect(audits.filter((a) => a.outcome === "failure").length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("different dates created concurrently both land", async () => {
    const { tenant } = await newTenant("AP", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const mk = (d: string) => createVersion(tenant, { stateCode: "AP", effectiveFrom: d, reason: "Concurrent distinct dates", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 12000 }] });
    const rs = await Promise.all([mk("2099-04-01"), mk("2099-05-01"), mk("2099-06-01")]);
    expect(rs.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    const rows = await until(() => versionsOf(tenant, "AP"), (r) => r.length === 4);
    expect(new Set(rows.map((r) => r.eff))).toEqual(new Set(["1900-01-01", "2099-04-01", "2099-05-01", "2099-06-01"]));
  }, 60_000);
});

describe("gender-specific slabs (0086)", () => {
  const empG = (id: string, state: string, gender: string | null) => ({ ...employee(id, state), gender });
  const GENDER_SLABS = [
    { fromMinor: 0, toMinor: 999999999999, taxMinor: 20000 },
    { fromMinor: 0, toMinor: 999999999999, taxMinor: 0, appliesToGender: "female" },
  ];

  it("creates a version with gender slabs; the run picks female / male / unknown correctly and warns for unknown", async () => {
    const { tenant, structure } = await newTenant("MH", [], false);
    const r = await createVersion(tenant, { stateCode: "MH", effectiveFrom: "2026-12-01", reason: "Gender slab test version", slabs: GENDER_SLABS });
    expect(r.statusCode).toBe(202);
    await until(() => versionsOf(tenant, "MH"), (rows) => rows.length === 2);
    const stored = await q(tenant, sql`SELECT applies_to_gender AS g FROM payroll.payroll_professional_tax WHERE state_code = 'MH' ORDER BY applies_to_gender`);
    expect(stored.map((x) => x.g)).toEqual(["all", "female"]);

    // a past version is needed for a run: baseline in force, then the gender version from 2099
    const fem = randomUUID(); const mal = randomUUID(); const unk = randomUUID(); const oth = randomUUID();
    const run = await runMonth(tenant, structure, "2027-01", [empG(fem, "MH", "female"), empG(mal, "MH", "male"), empG(unk, "MH", null), empG(oth, "MH", "other")]);
    expect(await ptOf(tenant, run, fem)).toBe(0);
    expect(await ptOf(tenant, run, mal)).toBe(20000);
    expect(await ptOf(tenant, run, unk)).toBe(20000);
    expect(await ptOf(tenant, run, oth)).toBe(20000);
    const warn = await q(tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record'
      AND payload->>'action' = 'warning' AND payload->>'code' = 'PT_GENDER_UNKNOWN' AND payload->>'resourceId' = ${run}`);
    expect(warn).toHaveLength(1);
    expect((warn[0]!.payload as { count: number }).count).toBe(2);
  }, 120_000);

  it("no warning when the slabs are not gender-specific", async () => {
    const { tenant, structure } = await newTenant("KA", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const emp = randomUUID();
    const run = await runMonth(tenant, structure, "2026-05", [empG(emp, "KA", null)]);
    expect(await ptOf(tenant, run, emp)).toBe(20000);
    const warn = await q(tenant, sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND payload->>'code' = 'PT_GENDER_UNKNOWN'`);
    expect(warn).toHaveLength(0);
  }, 60_000);

  it("the Article 276(2) cap still clamps a gender slab", async () => {
    const { tenant, structure } = await newTenant("TN", [], false);
    await createVersion(tenant, { stateCode: "TN", effectiveFrom: "2026-12-01", reason: "Gender cap test version", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 30000, appliesToGender: "female" }, { fromMinor: 0, toMinor: 999999999999, taxMinor: 10000 }] });
    await until(() => versionsOf(tenant, "TN"), (rows) => rows.length === 2);
    const emp = randomUUID();
    await seedFinalised(tenant, structure, emp, "2026-12", 240000);
    const run = await runMonth(tenant, structure, "2027-01", [empG(emp, "TN", "female")]);
    expect(await ptOf(tenant, run, emp)).toBe(10000);
  }, 90_000);

  it("overlap is refused per gender group at the route (female overlapping female) but allowed across groups", async () => {
    const { tenant } = await newTenant("GJ", [], false);
    const bad = await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs: [
      { fromMinor: 0, toMinor: 100, taxMinor: 0, appliesToGender: "female" }, { fromMinor: 50, toMinor: 200, taxMinor: 0, appliesToGender: "female" }] });
    expect(bad.statusCode).toBe(422);
    const ok = await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs: [
      { fromMinor: 0, toMinor: 100, taxMinor: 0, appliesToGender: "female" }, { fromMinor: 0, toMinor: 100, taxMinor: 0 }] });
    expect(ok.statusCode).toBe(202);
    const badGender = await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-07-01", slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 0, appliesToGender: "other" }] });
    expect(badGender.statusCode).toBe(400);
  }, 60_000);

  it("the version listing carries appliesToGender; legacy slabs read as 'all'", async () => {
    const { tenant } = await newTenant("RJ", [{ from: 0, to: 999999999999, amt: 100 }], false);
    await createVersion(tenant, { stateCode: "RJ", effectiveFrom: "2099-01-01", reason: "Gender listing test version", slabs: GENDER_SLABS });
    await until(() => versionsOf(tenant, "RJ"), (rows) => rows.length === 3);
    const list = (await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions?stateCode=RJ", headers: hdr(tenant, ["hr_admin"]) })).json() as { states: Array<{ versions: Array<{ slabs: Array<{ appliesToGender: string }> }> }> };
    const vs = list.states[0]!.versions;
    expect(vs[0]!.slabs.map((x) => x.appliesToGender)).toEqual(["all"]);
    expect(vs[1]!.slabs.map((x) => x.appliesToGender).sort()).toEqual(["all", "female"]);
  }, 60_000);
});

describe("PT follows the employee's state of employment", () => {
  const empS = (id: string, state: string | null) => ({ ...employee(id, state ?? ""), stateCode: state });
  const addState = (tenant: string, state: string, amt: number) => asTenant(tenant, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.payroll_pt_slab_versions (tenant_id, state_code, effective_from, reason, source) VALUES (${tenant}::uuid, ${state}, '1900-01-01', 'multi-state test', 'migration')`);
    await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, effective_from)
      VALUES (${tenant}::uuid, ${state}, 0, 999999999999, ${amt}, '1900-01-01')`);
  });
  const warnings = (tenant: string, run: string, code: string) => q(tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid
    AND topic = 'audit.event.record' AND payload->>'action' = 'warning' AND payload->>'code' = ${code} AND payload->>'resourceId' = ${run}`);

  it("two employees in different states get their own state's slabs (state code is case-insensitive); no warning", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000 }]);
    await addState(tenant, "KA", 10000);
    const mh = randomUUID(); const ka = randomUUID();
    const run = await runMonth(tenant, structure, "2026-05", [empS(mh, "MH"), empS(ka, "ka")]);
    expect(await ptOf(tenant, run, mh)).toBe(20000);
    expect(await ptOf(tenant, run, ka)).toBe(10000);
    expect(await warnings(tenant, run, "PT_STATE_UNKNOWN")).toHaveLength(0);
  }, 90_000);

  it("a missing state with PT versions in more than one state warns once (PT_STATE_UNKNOWN) and falls back to the tenant-wide slabs", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000 }]);
    await addState(tenant, "KA", 10000);
    const mh = randomUUID(); const none = randomUUID(); const none2 = randomUUID();
    const run = await runMonth(tenant, structure, "2026-05", [empS(mh, "MH"), empS(none, null), empS(none2, null)]);
    expect(await ptOf(tenant, run, mh)).toBe(20000);
    expect([10000, 20000]).toContain(await ptOf(tenant, run, none)); // the tenant-wide fallback, not 0
    const w = await warnings(tenant, run, "PT_STATE_UNKNOWN");
    expect(w).toHaveLength(1);
    expect((w[0]!.payload as { count: number }).count).toBe(2);
  }, 90_000);

  it("a missing state in a single-state tenant uses that state's slabs and does not warn", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const none = randomUUID();
    const run = await runMonth(tenant, structure, "2026-05", [empS(none, null)]);
    expect(await ptOf(tenant, run, none)).toBe(20000);
    expect(await warnings(tenant, run, "PT_STATE_UNKNOWN")).toHaveLength(0);
  }, 60_000);
});
