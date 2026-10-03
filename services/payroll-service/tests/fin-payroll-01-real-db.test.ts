/**
 * fin-payroll-01 finish batch -- real Postgres.
 *
 *  COSTING-02   server-authoritative group split cap (route + consumer race),
 *               edit / deactivate / reactivate, audit, tenant scoping
 *  DISB-01      audited bank-account reveal (audit BEFORE the number; role gate;
 *               reason; beneficiary-changed guard)
 *  DISB-08      run totals also as integer-paise strings
 *  FNF-03       pay-snapshot + 422 on a deviating input without an override reason
 *  FNF-05       death settlement needs a nominee; account sealed, never returned
 *  LOANS-01     payroll-role employee lookup
 *  LOANS-05     server-allocated loan numbers (concurrent), EMI bounds
 *  SLIPS-DETAIL-02  slip detail carries paise (contract)
 *  DETAIL-02    tenant letterhead (+ PDF issuer), RETURNS-01 filing record
 *
 * Requires DATABASE_URL pointing at a disposable Postgres migrated through 0060.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const REASON = "Reconciling the March salary credit with the bank statement";

const EMP = { id: randomUUID(), employeeNo: "FP1-EMP-001", fullName: "Asha Rao", bankAccountNo: "123456789012", bankIfsc: "SBIN0001234" };
const EMP2 = { id: randomUUID(), employeeNo: "FP1-EMP-002", fullName: "Vikram Singh", bankAccountNo: "998877665544", bankIfsc: "HDFC0000123" };
const hrms = { accountOverride: null as string | null, snapshot: { kind: "ok", completedYears: 10, leaveBalanceDays: 5 } as { kind: "ok"; completedYears: number; leaveBalanceDays: number } | { kind: "not_found" } | { kind: "unavailable" }, nameOverride: null as string | null };

vi.mock("../src/shared/hrms-client.js", () => ({
  HrmsUnavailableError: class HrmsUnavailableError extends Error {},
  fetchFnfServiceSnapshot: vi.fn(async () => hrms.snapshot),
  searchEmployeeSummaries: vi.fn(async (_t: string, f: { q?: string; ids?: string[] }) => {
    const all = [EMP, EMP2].map((e) => [e.id, { fullName: e.fullName, departmentName: e.id === EMP.id ? "Finance" : "Works", employeeNo: e.employeeNo }] as const);
    const needle = f.q?.toLowerCase();
    return new Map(all.filter(([id, e]) => (!f.ids || f.ids.includes(id)) && (!needle || e.fullName.toLowerCase().includes(needle) || e.employeeNo.toLowerCase().includes(needle))));
  }),
  fetchPayrollInput: vi.fn(async () => ({
    employees: [EMP, EMP2].map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.id === EMP.id && hrms.nameOverride ? hrms.nameOverride : e.fullName, basicMinor: "0",
      payStructureId: null, bankAccountNo: e.id === EMP.id && hrms.accountOverride ? hrms.accountOverride : e.bankAccountNo, bankIfsc: e.bankIfsc,
      pan: null, uan: null, cityClass: "X", taxRegime: "new", departmentId: null, pensionScheme: "NPS",
    })),
    lopDays: {},
  })),
  fetchPendingPayrollRuns: vi.fn(async () => 0),
  fetchEmployeeSummaries: vi.fn(async () => new Map([
    [EMP.id, { fullName: hrms.nameOverride ?? EMP.fullName, departmentName: hrms.nameOverride ? "<b>Dept</b>" : "Finance", employeeNo: EMP.employeeNo }],
    [EMP2.id, { fullName: EMP2.fullName, departmentName: "Works", employeeNo: EMP2.employeeNo }],
  ])),
}));

const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
const { registerCostingRuleConsumers } = await import("../src/modules/costing-rules/consumer.js");
const { registerFnfConsumers } = await import("../src/modules/fnf/consumer.js");
const { registerLoansConsumers } = await import("../src/modules/loans/consumer.js");
const { registerLetterheadConsumers } = await import("../src/modules/letterhead/consumer.js");
const { registerReturnFilingConsumers } = await import("../src/modules/return-filings/consumer.js");

// Mirror worker.ts: every consumer runs inside runWithTenant(msg.tenantId).
{
  type H = (m: { tenantId: string }) => Promise<void>;
  const q = queue as unknown as { subscribe: (topic: string, h: H) => void };
  const raw = q.subscribe.bind(q);
  q.subscribe = (topic: string, h: H) => raw(topic, (m) => runWithTenant(m.tenantId, () => h(m)) as Promise<void>);
}
registerPayrollConsumers(queue);
registerCostingRuleConsumers(queue);
registerFnfConsumers(queue);
registerLoansConsumers(queue);
registerLetterheadConsumers(queue);
registerReturnFilingConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

type TxRunner = { execute: (q: unknown) => Promise<unknown> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> => Array.from(r as Iterable<Record<string, unknown>>);
const scoped = <T,>(tenantId: string, fn: (tx: TxRunner) => Promise<T>): Promise<T> => withTenantScope(db as never, tenantId, fn as never) as Promise<T>;
const token = (roles: string[], tenantId = TENANT) => signToken({ sub: ACTOR, tid: tenantId, roles, sid: "s1" }, SECRET);
const auth = (roles: string[] = ["payroll_admin"], tenantId = TENANT) => ({ authorization: `Bearer ${token(roles, tenantId)}` });

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await queue.start();
});
afterAll(async () => {
  await queue.stop();
  await app?.close();
  await sqlClient.end();
});

async function auditRows(tenantId: string, action: string, resourceId?: string) {
  return scoped(tenantId, async (tx) => rowsOf(await tx.execute(sql`
    SELECT payload FROM _outbox.messages
     WHERE tenant_id = ${tenantId}::uuid AND topic = 'audit.event.record' AND payload->>'action' = ${action}
       AND (${resourceId ?? null}::text IS NULL OR payload->>'resourceId' = ${resourceId ?? null}::text)
     ORDER BY created_at`)));
}

// ─── COSTING-02 ──────────────────────────────────────────────────────────────
describe("GAP-PAYROLL-COSTING-02 costing rule split cap + edit/deactivate", () => {
  const CC = [randomUUID(), randomUUID(), randomUUID()];
  const post = (group: string, cc: string, splitPct: number, tenantId = TENANT) =>
    app.inject({ method: "POST", url: "/v1/payroll/costing/rules", payload: { employeeGroup: group, costCenterId: cc, splitPct }, headers: auth(["payroll_admin"], tenantId) });
  const patch = (id: string, body: Record<string, unknown>, roles = ["payroll_admin"], tenantId = TENANT) =>
    app.inject({ method: "PATCH", url: `/v1/payroll/costing/rules/${id}`, payload: body, headers: auth(roles, tenantId) });
  const rules = (group: string, tenantId = TENANT) => scoped(tenantId, async (tx) => rowsOf(await tx.execute(sql`
    SELECT id, cost_center_id, split_pct::text AS split_pct, status FROM payroll.costing_rules
     WHERE tenant_id = ${tenantId}::uuid AND employee_group = ${group} ORDER BY split_pct DESC, cost_center_id`)));

  it("create: 60 + 30 accepted, a third rule taking the group past 100 is a 422 and writes nothing", async () => {
    const g = "G-cap";
    expect((await post(g, CC[0]!, 60)).statusCode).toBe(202);
    expect((await post(g, CC[1]!, 30)).statusCode).toBe(202);
    await drain();
    const over = await post(g, CC[2]!, 11);
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe("COSTING_SPLIT_EXCEEDS_100");
    expect((await post(g, CC[2]!, 10)).statusCode).toBe(202); // exactly 100 is fine
    await drain();
    expect((await rules(g)).map((r) => r.split_pct).sort()).toEqual(["10.00", "30.00", "60.00"]);
  });

  it("create: upserting the SAME cost centre replaces its split instead of adding to it", async () => {
    const g = "G-upsert";
    expect((await post(g, CC[0]!, 100)).statusCode).toBe(202);
    await drain();
    expect((await post(g, CC[0]!, 70)).statusCode).toBe(202); // 100 -> 70, not 170
    await drain();
    expect((await rules(g)).map((r) => r.split_pct)).toEqual(["70.00"]);
  });

  it("create: more than 2 decimals / zero / >100 are rejected", async () => {
    expect((await post("G-v", CC[0]!, 33.333)).statusCode).toBe(422);
    expect((await post("G-v", CC[0]!, 0)).statusCode).toBe(422);
    expect((await post("G-v", CC[0]!, 100.5)).statusCode).toBe(400);
  });

  it("edit split, deactivate (drops out of the group total) and reactivate -- each audited with from/to", async () => {
    const g = "G-edit";
    await post(g, CC[0]!, 60); await post(g, CC[1]!, 40); await drain();
    const [a, b] = await rules(g);
    // raising A to 70 would make 110
    const tooBig = await patch(a!.id as string, { splitPct: 70 });
    expect(tooBig.statusCode).toBe(422);
    expect((await patch(a!.id as string, { splitPct: 50 })).statusCode).toBe(202);
    await drain();
    expect((await rules(g)).find((r) => r.id === a!.id)!.split_pct).toBe("50.00");
    // deactivate B, then A can take 100
    expect((await patch(b!.id as string, { status: "inactive" })).statusCode).toBe(202);
    await drain();
    expect((await patch(a!.id as string, { splitPct: 100 })).statusCode).toBe(202);
    await drain();
    // reactivating B (40) now would make 140
    expect((await patch(b!.id as string, { status: "active" })).statusCode).toBe(422);
    const rows = await rules(g);
    expect(rows.find((r) => r.id === a!.id)).toMatchObject({ split_pct: "100.00", status: "active" });
    expect(rows.find((r) => r.id === b!.id)).toMatchObject({ status: "inactive" });
    const audits = await auditRows(TENANT, "costing_rule_update", a!.id as string);
    const last = audits.at(-1)!.payload as { outcome: string; detail: { from: { splitPct: number }; to: { splitPct: number } } };
    expect(last.outcome).toBe("success");
    expect(last.detail.from.splitPct).toBe(50);
    expect(last.detail.to.splitPct).toBe(100);
  });

  it("race: many reactivations that each fit alone but not together -- consumers run concurrently and the group never exceeds 100% (per-group lock)", async () => {
    const g = "G-race";
    // 40 active + eight inactive 20% rules: each alone passes (60), but only three can fit together (100).
    await scoped(TENANT, async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.costing_rules (id, tenant_id, employee_group, cost_center_id, split_pct, status, created_by)
        VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, ${g}, ${randomUUID()}::uuid, 40, 'active', ${ACTOR}::uuid)`);
      for (let i = 0; i < 8; i++) {
        await tx.execute(sql`INSERT INTO payroll.costing_rules (id, tenant_id, employee_group, cost_center_id, split_pct, status, created_by)
          VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, ${g}, ${randomUUID()}::uuid, 20, 'inactive', ${ACTOR}::uuid)`);
      }
    });
    const inactive = (await rules(g)).filter((r) => r.status === "inactive");
    expect(inactive).toHaveLength(8);
    // Publish all commands in the same tick, bypassing the route (its pre-check
    // would see the first one land): the memory queue runs the consumer
    // transactions OVERLAPPED, so only the advisory lock serialises them.
    const { requestCostingRuleUpdate } = await import("../src/modules/costing-rules/commands.js");
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID() } as never;
    await Promise.all(inactive.map((r) => requestCostingRuleUpdate(ctx, { ruleId: r.id as string, status: "active" })));
    await drain();
    const active = (await rules(g)).filter((r) => r.status === "active");
    expect(active.reduce((s, r) => s + Number(r.split_pct), 0)).toBeLessThanOrEqual(100);
    expect(active).toHaveLength(4); // the 40% rule + exactly three 20% rules
    const failed = (await auditRows(TENANT, "costing_rule_update")).filter((a) => (a.payload as { detail: { code?: string } }).detail.code === "COSTING_SPLIT_EXCEEDS_100");
    expect(failed.length).toBe(5);
  });

  it("role + tenant: employee gets 403; another tenant's rule is a 404", async () => {
    const g = "G-tenant";
    await post(g, CC[0]!, 50); await drain();
    const [rule] = await rules(g);
    expect((await patch(rule!.id as string, { splitPct: 10 }, ["employee"])).statusCode).toBe(403);
    expect((await patch(rule!.id as string, { splitPct: 10 }, ["payroll_admin"], OTHER_TENANT)).statusCode).toBe(404);
    expect((await patch(rule!.id as string, {})).statusCode).toBe(400);
  });
});

// ─── DISB-01 / DISB-08 ───────────────────────────────────────────────────────
describe("GAP-PAYROLL-DISBURSEMENT-01 audited account reveal + -08 paise totals", () => {
  let runId = "";
  let transferId = "";
  beforeAll(async () => {
    runId = randomUUID();
    transferId = randomUUID();
    await scoped(TENANT, async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, total_net_minor, created_by, updated_by)
        VALUES (${runId}::uuid, ${TENANT}::uuid, ${"FP1/" + runId.slice(0, 8)}, '2001-01', ${randomUUID()}::uuid, 'approved', 5000000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`
        INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, total_deductions_minor, net_pay_minor, status, created_by, updated_by)
        VALUES (${TENANT}::uuid, ${runId}::uuid, ${EMP.id}::uuid, ${EMP.employeeNo}, 6000050, 1000025, 5000025, 'computed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`
        INSERT INTO payroll.disbursement_transfers
          (id, tenant_id, run_id, employee_id, employee_no, beneficiary_name, account_last4, ifsc, amount_minor, status, attempt_no, created_by, updated_by)
        VALUES (${transferId}::uuid, ${TENANT}::uuid, ${runId}::uuid, ${EMP.id}::uuid, ${EMP.employeeNo}, ${EMP.fullName},
                ${EMP.bankAccountNo.slice(-4)}, ${EMP.bankIfsc}, 5000025, 'sent', 1, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    });
  });

  const reveal = (id: string, body: unknown, roles = ["payroll_officer"], tenantId = TENANT) =>
    app.inject({ method: "POST", url: `/v1/payroll/disbursement/transfers/${id}/reveal-account`, payload: body as object, headers: auth(roles, tenantId) });

  it("a payroll officer with a reason gets the number once, no-store; the audit is published first and never contains the number", async () => {
    const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const orig = queue.publish.bind(queue);
    const spy = vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: never) => {
      published.push({ type: topic, payload: (msg as { payload: Record<string, unknown> }).payload });
      return orig(topic, msg);
    });
    const res = await reveal(transferId, { reason: REASON });
    spy.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().data).toMatchObject({ accountNumber: EMP.bankAccountNo, ifsc: EMP.bankIfsc, visibleSeconds: 30 });
    const audit = published.find((p) => p.type === "audit.event.record" && p.payload.action === "bank_account_revealed");
    expect(audit).toBeTruthy();
    expect(audit!.payload).toMatchObject({ resourceType: "disbursement_transfer", resourceId: transferId, outcome: "success" });
    expect(JSON.stringify(audit)).not.toContain(EMP.bankAccountNo);
    expect((audit!.payload.detail as { reason: string }).reason).toBe(REASON);
  });

  it("no audit, no number: a failing audit publish fails the request and reveals nothing", async () => {
    const spy = vi.spyOn(queue, "publish").mockRejectedValue(new Error("queue down"));
    const res = await reveal(transferId, { reason: REASON });
    spy.mockRestore();
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.body).not.toContain(EMP.bankAccountNo);
  });

  it("guards: employee 403, reason required (>=10), unknown id 404, other tenant 404, changed account 409", async () => {
    expect((await reveal(transferId, { reason: REASON }, ["employee"])).statusCode).toBe(403);
    expect((await reveal(transferId, { reason: REASON }, ["hr_admin"])).statusCode).toBe(403);
    expect((await reveal(transferId, { reason: "short" })).statusCode).toBe(400);
    expect((await reveal(transferId, {})).statusCode).toBe(400);
    expect((await reveal(randomUUID(), { reason: REASON })).statusCode).toBe(404);
    expect((await reveal(transferId, { reason: REASON }, ["payroll_admin"], OTHER_TENANT)).statusCode).toBe(404);
    hrms.accountOverride = "111122223333"; // master now ends 3333, the ledger says 9012
    const changed = await reveal(transferId, { reason: REASON });
    hrms.accountOverride = null;
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe("BENEFICIARY_CHANGED");
    expect(changed.body).not.toContain("111122223333");
  });

  it("a transfer with no recorded account tail is never revealed (409 ACCOUNT_UNVERIFIABLE)", async () => {
    await scoped(TENANT, (tx) => tx.execute(sql`UPDATE payroll.disbursement_transfers SET account_last4 = NULL WHERE id = ${transferId}::uuid`));
    const res = await reveal(transferId, { reason: REASON });
    await scoped(TENANT, (tx) => tx.execute(sql`UPDATE payroll.disbursement_transfers SET account_last4 = ${EMP.bankAccountNo.slice(-4)} WHERE id = ${transferId}::uuid`));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_UNVERIFIABLE");
    expect(res.body).not.toContain(EMP.bankAccountNo);
  });

  it("GET /v1/payroll/runs also returns exact integer-paise totals as strings (the rupee fields are unchanged)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs?limit=50", headers: auth() });
    expect(res.statusCode).toBe(200);
    const run = (res.json() as Array<Record<string, unknown>>).find((r) => r.id === runId)!;
    expect(run).toMatchObject({ grossMinor: "6000050", netMinor: "5000025", deductionsMinor: "1000025", netAmount: 50000.25 });
  });
});

// ─── FNF-03 / FNF-05 ─────────────────────────────────────────────────────────
describe("GAP-PAYROLL-FNF-03 pay-snapshot + deviation rejection, FNF-05 death nominee", () => {
  const EMP_FNF = randomUUID();
  const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
  beforeAll(async () => {
    await scoped(TENANT, async (tx) => {
      for (const [i, month] of months.entries()) {
        const runId = randomUUID();
        await tx.execute(sql`
          INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, run_type, created_by, updated_by)
          VALUES (${runId}::uuid, ${TENANT}::uuid, ${"F/" + runId.slice(0, 8)}, ${month}, ${randomUUID()}::uuid, ${i === 5 ? "draft" : "approved"}, 'regular', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
        await tx.execute(sql`
          INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, net_pay_minor, tds_minor, components, status, created_by, updated_by)
          VALUES (${TENANT}::uuid, ${runId}::uuid, ${EMP_FNF}::uuid, 'FNF-1', 5000000, 7000000, 6000000, 100000,
                  ${JSON.stringify([{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 5000000 }, { code: "DA", name: "DA", type: "earning", amountMinor: 1000000 }])}::jsonb,
                  'computed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      }
    });
  });

  const base = () => ({
    employeeId: EMP_FNF, separationDate: "2026-02-28", separationType: "resignation", employeeCategory: "non_govt_covered",
    lastDrawnWagesMinor: "6000000", completedYears: 10, avgSalaryLast10MonthsMinor: "6000000", leaveBalanceDays: 5,
    taxRegime: "new", salaryYtdMinor: "35000000", tdsYtdMinor: "500000", fyStartYear: 2025,
  });
  const compute = (body: Record<string, unknown>, roles = ["payroll_admin"]) =>
    app.inject({ method: "POST", url: "/v1/payroll/fnf/compute", payload: body, headers: auth(roles) });

  it("pay-snapshot derives wages / 10-month average / FY-to-date from approved regular payslips only (draft run ignored, months after separation ignored)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/fnf/pay-snapshot?employeeId=${EMP_FNF}&separationDate=2026-02-28`, headers: auth() });
    expect(res.statusCode).toBe(200);
    // Oct..Feb = 5 approved months (Mar is a draft run AND after the separation month)
    expect(res.json().data).toMatchObject({
      available: true, fyStartYear: 2025, wageMonths: 5, ytdMonths: 5,
      lastDrawnWagesMinor: "6000000", avgSalaryLast10MonthsMinor: "6000000",
      salaryYtdMinor: "35000000", tdsYtdMinor: "500000",
    });
  });

  it("pay-snapshot: an employee with no payslips is 'not available' (nothing to hold a clerk to)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/fnf/pay-snapshot?employeeId=${randomUUID()}&separationDate=2026-02-28`, headers: auth() });
    expect(res.json().data.available).toBe(false);
  });

  it("compute with values equal to the pay records is accepted", async () => {
    expect((await compute(base())).statusCode).toBe(202);
    await drain();
    const rows = await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT status FROM payroll.fnf_settlements WHERE employee_id = ${EMP_FNF}::uuid`)));
    expect(rows).toHaveLength(1);
  });

  it("a hand-typed wage / YTD that differs from the pay records without an override reason is a 422 naming the fields", async () => {
    const res = await compute({ ...base(), salaryYtdMinor: "99999999", lastDrawnWagesMinor: "6500000" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FNF_OVERRIDE_REQUIRED");
    expect(res.json().message).toContain("salaryYtd");
    expect(res.json().message).toContain("lastDrawnWages");
    // overriding only one of the two is still a 422 for the other
    const partial = await compute({ ...base(), salaryYtdMinor: "99999999", lastDrawnWagesMinor: "6500000", overrides: { fields: ["salaryYtd"], reason: "Bonus paid outside payroll" } });
    expect(partial.statusCode).toBe(422);
    expect(partial.json().message).toContain("lastDrawnWages");
  });

  it("an override with a reason is accepted and the reason + derived values are persisted on the settlement", async () => {
    const emp = randomUUID();
    await scoped(TENANT, async (tx) => {
      const runId = randomUUID();
      await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, run_type, created_by, updated_by)
        VALUES (${runId}::uuid, ${TENANT}::uuid, ${"F2/" + runId.slice(0, 8)}, '2025-04', ${randomUUID()}::uuid, 'approved', 'regular', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, net_pay_minor, tds_minor, status, created_by, updated_by)
        VALUES (${TENANT}::uuid, ${runId}::uuid, ${emp}::uuid, 'FNF-2', 5000000, 7000000, 6000000, 100000, 'computed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    });
    const res = await compute({ ...base(), employeeId: emp, separationDate: "2025-04-30", salaryYtdMinor: "8000000", fyStartYear: 2025,
      lastDrawnWagesMinor: "5000000", avgSalaryLast10MonthsMinor: "5000000", tdsYtdMinor: "100000",
      overrides: { fields: ["salaryYtd"], reason: "Arrears of 10,00,000 paid in the same month" } });
    expect(res.statusCode).toBe(202);
    await drain();
    const [row] = await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT computation_detail FROM payroll.fnf_settlements WHERE employee_id = ${emp}::uuid`)));
    const detail = row!.computation_detail as { overrides: { fields: string[]; reason: string; derived: Record<string, string> } };
    expect(detail.overrides.reason).toContain("Arrears");
    expect(detail.overrides.derived.salaryYtd).toBe("7000000");
  });

  it("FNF-03: service length and leave balance are held to hrms-service's figures: a differing value without an override reason is a 422", async () => {
    const res = await compute({ ...base(), employeeId: randomUUID(), completedYears: 12, leaveBalanceDays: 99 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FNF_OVERRIDE_REQUIRED");
    expect(res.json().message).toContain("completedYears");
    expect(res.json().message).toContain("leaveBalanceDays");
    const ok = await compute({ ...base(), employeeId: randomUUID(), completedYears: 12, leaveBalanceDays: 99, overrides: { fields: ["completedYears", "leaveBalanceDays"], reason: "Service book shows deputation counted towards service" } });
    expect(ok.statusCode).toBe(202);
    await drain();
    const [row] = await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT computation_detail FROM payroll.fnf_settlements ORDER BY created_at DESC LIMIT 1`)));
    const d = row!.computation_detail as { overrides: { derived: Record<string, string> } };
    expect(d.overrides.derived).toMatchObject({ completedYears: "10", leaveBalanceDays: "5" });
  });

  it("FNF-03 (fail closed): HRMS unreachable or malformed -> 503 FNF_HR_VERIFICATION_UNAVAILABLE and NOTHING is queued", async () => {
    hrms.snapshot = { kind: "unavailable" };
    const emp = randomUUID();
    const published: string[] = [];
    const orig = queue.publish.bind(queue);
    const spy = vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: never) => { published.push(topic); return orig(topic, msg); });
    const res = await compute({ ...base(), employeeId: emp });
    spy.mockRestore();
    hrms.snapshot = { kind: "ok", completedYears: 10, leaveBalanceDays: 5 };
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("FNF_HR_VERIFICATION_UNAVAILABLE");
    expect(published.filter((p) => p.includes("fnf"))).toEqual([]);
    await drain();
    const rows = await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT 1 FROM payroll.fnf_settlements WHERE employee_id = ${emp}::uuid`)));
    expect(rows).toHaveLength(0);
  });

  it("FNF-03: an employee HRMS does not know (404) is a 422 FNF_EMPLOYEE_NOT_IN_HR, nothing stored", async () => {
    hrms.snapshot = { kind: "not_found" };
    const emp = randomUUID();
    const res = await compute({ ...base(), employeeId: emp });
    hrms.snapshot = { kind: "ok", completedYears: 10, leaveBalanceDays: 5 };
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FNF_EMPLOYEE_NOT_IN_HR");
    await drain();
    expect(await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT 1 FROM payroll.fnf_settlements WHERE employee_id = ${emp}::uuid`)))).toHaveLength(0);
  });

  it("FNF-03: a healthy HRMS check is stamped hrRecordsVerified=true on the stored calculation", async () => {
    const emp = randomUUID();
    expect((await compute({ ...base(), employeeId: emp })).statusCode).toBe(202);
    await drain();
    const [row] = await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT computation_detail FROM payroll.fnf_settlements WHERE employee_id = ${emp}::uuid`)));
    expect((row!.computation_detail as { hrRecordsVerified?: boolean }).hrRecordsVerified).toBe(true);
  });

  const nominee = { name: "Sunita Devi", relationship: "spouse", accountNumber: "50100123456789", ifsc: "HDFC0001234", documentRef: "LHC/2026/0042" };
  it("FNF-05: a death settlement without nominee details is a 400; nominee on a non-death settlement is a 400", async () => {
    expect((await compute({ ...base(), employeeId: randomUUID(), separationType: "death" })).statusCode).toBe(400);
    expect((await compute({ ...base(), employeeId: randomUUID(), nominee })).statusCode).toBe(400);
    expect((await compute({ ...base(), employeeId: randomUUID(), separationType: "death", nominee: { ...nominee, ifsc: "BAD" } })).statusCode).toBe(400);
  });

  it("FNF-05: death settlement stores the nominee; the account is sealed in the DB and never returned by the API or leaked through the queue/audit", async () => {
    const emp = randomUUID();
    const res = await compute({ ...base(), employeeId: emp, separationType: "death", separationDate: "2026-02-10", nominee });
    expect(res.statusCode).toBe(202);
    await drain();
    const [row] = await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`
      SELECT id, nominee_name, nominee_relationship, nominee_ifsc, nominee_account_last4, nominee_account_sealed, nominee_document_ref
        FROM payroll.fnf_settlements WHERE employee_id = ${emp}::uuid`)));
    expect(row).toMatchObject({ nominee_name: "Sunita Devi", nominee_relationship: "spouse", nominee_ifsc: "HDFC0001234", nominee_account_last4: "6789", nominee_document_ref: "LHC/2026/0042" });
    expect(String(row!.nominee_account_sealed)).toMatch(/^enc:v2:/);
    expect(String(row!.nominee_account_sealed)).not.toContain(nominee.accountNumber);

    const get = await app.inject({ method: "GET", url: `/v1/payroll/fnf/settlements/${row!.id}`, headers: auth() });
    expect(get.statusCode).toBe(200);
    expect(get.body).not.toContain(nominee.accountNumber);
    expect(get.json().data.nominee).toEqual({ name: "Sunita Devi", relationship: "spouse", ifsc: "HDFC0001234", accountLast4: "6789", documentRef: "LHC/2026/0042" });
    const outbox = await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT payload::text AS p FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid`)));
    expect(outbox.some((o) => String(o.p).includes(nominee.accountNumber))).toBe(false);
  });

  it("the DB CHECK refuses a death settlement without a nominee even if the app layer were bypassed", async () => {
    await expect(scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO payroll.fnf_settlements (tenant_id, employee_id, separation_type, separation_date, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${randomUUID()}::uuid, 'death', '2026-01-01', ${ACTOR}::uuid, ${ACTOR}::uuid)`))).rejects.toThrow();
  });
});

// ─── LOANS-01 / LOANS-05 ─────────────────────────────────────────────────────
describe("GAP-PAYROLL-LOANS-01 employee lookup, -05 loan numbers + EMI bounds", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    employeeId: EMP.id, loanType: "personal", principalMinor: 1_200_000, emiMinor: 100_000, tenureMonths: 12, interestRatePct: 0, ...over,
  });
  const create = (b: Record<string, unknown>, key?: string, roles = ["payroll_admin"]) =>
    app.inject({ method: "POST", url: "/v1/payroll/loans", payload: b, headers: { ...auth(roles), ...(key ? { "x-idempotency-key": key } : {}) } });
  const loans = () => scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`
    SELECT loan_no, principal_minor::text AS principal FROM loans.payroll_loans WHERE tenant_id = ${TENANT}::uuid ORDER BY loan_no`)));

  it("lookup: a payroll_officer (no HRMS directory access) can search by name or code, ids resolve, employees are refused", async () => {
    const byName = await app.inject({ method: "GET", url: "/v1/payroll/employee-lookup?q=asha", headers: auth(["payroll_officer"]) });
    expect(byName.statusCode).toBe(200);
    expect(byName.json().data).toEqual([{ id: EMP.id, employeeNo: EMP.employeeNo, name: "Asha Rao", department: "Finance" }]);
    const byCode = await app.inject({ method: "GET", url: "/v1/payroll/employee-lookup?q=fp1-emp-002", headers: auth(["finance_officer"]) });
    expect(byCode.json().data.map((r: { id: string }) => r.id)).toEqual([EMP2.id]);
    const byIds = await app.inject({ method: "GET", url: `/v1/payroll/employee-lookup?ids=${EMP.id},not-a-uuid,${EMP2.id}`, headers: auth() });
    expect(byIds.json().data).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/employee-lookup?q=a", headers: auth(["employee"]) })).statusCode).toBe(403);
    expect(JSON.stringify(byName.json())).not.toMatch(/pan|bank|account/i);
  });

  it("omitting loanNo allocates LN-<year>-<seq> from the per-tenant counter; N concurrent creates get N distinct, gap-free numbers", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => create(body({ employeeId: randomUUID() }), `alloc-key-${i}-${randomUUID()}`)));
    expect(results.map((r) => r.statusCode)).toEqual([202, 202, 202, 202, 202]);
    await drain();
    const nos = (await loans()).map((l) => String(l.loan_no));
    const year = new Date().getFullYear();
    expect(nos).toHaveLength(5);
    expect(new Set(nos).size).toBe(5);
    expect(nos).toEqual([1, 2, 3, 4, 5].map((n) => `LN-${year}-${String(n).padStart(6, "0")}`));
  });

  it("a hand-typed number that collides with the next allocation is skipped, never reused", async () => {
    const year = new Date().getFullYear();
    expect((await create(body({ employeeId: randomUUID(), loanNo: `LN-${year}-000006` }), `typed-${randomUUID()}`)).statusCode).toBe(202);
    await drain();
    expect((await create(body({ employeeId: randomUUID() }), `next-${randomUUID()}`)).statusCode).toBe(202);
    await drain();
    expect((await loans()).map((l) => String(l.loan_no))).toContain(`LN-${year}-000007`);
  });

  it("typed loan numbers still 409 when taken", async () => {
    expect((await create(body({ employeeId: randomUUID(), loanNo: "MANUAL-1" }), `m1-${randomUUID()}`)).statusCode).toBe(202);
    await drain();
    expect((await create(body({ employeeId: randomUUID(), loanNo: "MANUAL-1" }), `m2-${randomUUID()}`)).statusCode).toBe(409);
  });

  it("server-side EMI bounds: EMI > principal, EMI x tenure < principal, EMI x tenure above the simple-interest total are all 422", async () => {
    const a = await create(body({ emiMinor: 1_300_000 }));
    expect(a.statusCode).toBe(422);
    expect(a.json().code).toBe("LOAN_EMI_EXCEEDS_PRINCIPAL");
    const b = await create(body({ emiMinor: 50_000 })); // 12 x 500 < 12000
    expect(b.json().code).toBe("LOAN_EMI_TOO_LOW_TO_REPAY");
    const c = await create(body({ emiMinor: 400_000, tenureMonths: 12 })); // 48,00,000 > 12,00,000 at 0%
    expect(c.json().code).toBe("LOAN_EMI_EXCEEDS_INTEREST_BOUND");
    // 10% for 12 months: simple-interest total = 13,20,000; 1,10,000 x 12 = 13,20,000 sits exactly on the bound -> accepted
    expect((await create(body({ employeeId: randomUUID(), interestRatePct: 10, emiMinor: 110_000 }), `ok-${randomUUID()}`)).statusCode).toBe(202);
    expect((await create(body({ employeeId: randomUUID(), interestRatePct: 10, emiMinor: 111_000 }))).statusCode).toBe(422);
  });
});

// ─── SLIPS-DETAIL-02 contract ────────────────────────────────────────────────
describe("GAP-PAYROLL-SLIPS-DETAIL-02 slip detail units (contract)", () => {
  it("GET /v1/payroll/slips/:id carries integer paise: basic Rs 50,000 is 5000000, and the web schema accepts the real payload", async () => {
    const { SalarySlipDetailSchema } = await import("@civitasone/schemas/web");
    const runId = randomUUID();
    const slipId = randomUUID();
    await scoped(TENANT, async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
        VALUES (${runId}::uuid, ${TENANT}::uuid, ${"S/" + runId.slice(0, 8)}, '2002-02', ${randomUUID()}::uuid, 'disbursed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, total_deductions_minor, net_pay_minor, components, status, created_by, updated_by)
        VALUES (${slipId}::uuid, ${TENANT}::uuid, ${runId}::uuid, ${EMP.id}::uuid, ${EMP.employeeNo}, 5000000, 6200000, 700000, 5500000,
                ${JSON.stringify([{ code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 5000000 }, { code: "PF", name: "PF", type: "deduction", amountMinor: 700000 }])}::jsonb,
                'paid', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    });
    const res = await app.inject({ method: "GET", url: `/v1/payroll/slips/${slipId}`, headers: auth(["payroll_admin"]) });
    expect(res.statusCode).toBe(200);
    const slip = res.json();
    expect(slip.basicMinor).toBe(5000000);
    expect(slip.components.find((c: { code: string }) => c.code === "BASIC").amountMinor).toBe(5000000);
    expect(slip.netMinor).toBe(5500000);
    const parsed = SalarySlipDetailSchema.parse(slip);
    expect(parsed.grossMinor).toBe(6200000);
  });
});

// ─── DETAIL-02 letterhead / RETURNS-01 filings ───────────────────────────────
describe("GAP-PAYROLL-SALARY-SLIPS-DETAIL-02 tenant letterhead", () => {
  const put = (body: unknown, roles = ["payroll_admin"], tenantId = TENANT) =>
    app.inject({ method: "PUT", url: "/v1/payroll/letterhead", payload: body as object, headers: auth(roles, tenantId) });
  const get = (roles = ["employee"], tenantId = TENANT) => app.inject({ method: "GET", url: "/v1/payroll/letterhead", headers: auth(roles, tenantId) });

  it("no letterhead -> null (the slip prints no authority line, it never invents one)", async () => {
    expect((await get()).json()).toEqual({ data: null });
  });

  it("payroll_admin sets it (audited, versioned); an employee can read but not write; tenants are isolated", async () => {
    expect((await put({ orgName: "Directorate of Urban Affairs", ddoCode: "DDO-114", showSignatureBlock: true, signatoryTitle: "Drawing & Disbursing Officer" }, ["employee"])).statusCode).toBe(403);
    expect((await put({ orgName: "  " })).statusCode).toBe(400);
    expect((await put({ orgName: "Directorate of Urban Affairs", ddoCode: "DDO-114", showSignatureBlock: true, signatoryTitle: "Drawing & Disbursing Officer" })).statusCode).toBe(202);
    await drain();
    expect((await get()).json().data).toMatchObject({ orgName: "Directorate of Urban Affairs", ddoCode: "DDO-114", showSignatureBlock: true, version: 1, department: null });
    expect((await put({ orgName: "Directorate of Urban Affairs (HQ)" })).statusCode).toBe(202);
    await drain();
    expect((await get()).json().data).toMatchObject({ orgName: "Directorate of Urban Affairs (HQ)", version: 2, showSignatureBlock: false });
    expect((await get(["employee"], OTHER_TENANT)).json()).toEqual({ data: null });
    const audits = await auditRows(TENANT, "update", TENANT);
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("the payslip PDF names the tenant's own organisation, HTML-escaped, and no hard-coded authority", async () => {
    await put({ orgName: "A & B <Dept>" }); await drain();
    const slipId = (await scoped(TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT id FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid AND status = 'paid' LIMIT 1`))))[0]!.id as string;
    const res = await app.inject({ method: "GET", url: `/v1/payroll/slips/${slipId}/pdf`, headers: auth(["payroll_admin"]) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain("A &amp; B &lt;Dept&gt;");
    expect(res.body).not.toContain("A & B <Dept>");
    expect(res.body).not.toContain(">Organization<");
  });
});

describe("GAP-PAYROLL-RETURNS-01 return filing record", () => {
  const post = (b: Record<string, unknown>, roles = ["payroll_officer"], tenantId = TENANT) =>
    app.inject({ method: "POST", url: "/v1/payroll/statutory/returns/filings", payload: b, headers: auth(roles, tenantId) });
  const list = (fy = "2025-26", roles = ["payroll_officer"], tenantId = TENANT) =>
    app.inject({ method: "GET", url: `/v1/payroll/statutory/returns/filings?fy=${fy}`, headers: auth(roles, tenantId) });
  const f = (over: Record<string, unknown> = {}) => ({ fy: "2025-26", quarter: "Q1", filedOn: "2025-07-28", receiptNo: "123456789012345", ...over });

  it("records a filing, lists it, audits it; duplicates (same revision / same receipt) are 409; a correction is the next revision", async () => {
    expect((await post(f())).statusCode).toBe(202);
    await drain();
    expect((await list()).json().data).toEqual([{ formType: "24Q", fy: "2025-26", quarter: "Q1", filedOn: "2025-07-28", receiptNo: "123456789012345", revision: 0, note: null }]);
    expect((await post(f({ receiptNo: "999999999999999" }))).json().code).toBe("FILING_ALREADY_RECORDED");
    expect((await post(f({ revision: 1 }))).json().code).toBe("RECEIPT_ALREADY_RECORDED");
    expect((await post(f({ revision: 1, receiptNo: "111111111111111", filedOn: "2025-09-01" }))).statusCode).toBe(202);
    await drain();
    expect((await list()).json().data.map((r: { revision: number }) => r.revision)).toEqual([1, 0]);
    expect((await auditRows(TENANT, "return_filing_recorded")).length).toBeGreaterThanOrEqual(2);
  });

  it("validation + gates: 15-digit receipt, no future date, no employee, tenant-isolated; the DB unique index is the race arbiter", async () => {
    expect((await post(f({ quarter: "Q2", receiptNo: "12345" }))).statusCode).toBe(400);
    expect((await post(f({ quarter: "Q2", filedOn: "2999-01-01" }))).statusCode).toBe(400);
    expect((await post(f({ quarter: "Q2" }), ["employee"])).statusCode).toBe(403);
    expect((await list("2025-26", ["payroll_officer"], OTHER_TENANT)).json().data).toEqual([]);
    // two racing commands for the same slot: both pass the pre-check (nothing recorded yet), exactly one row lands
    const [a, b] = await Promise.all([post(f({ quarter: "Q3", receiptNo: "222222222222222" })), post(f({ quarter: "Q3", receiptNo: "333333333333333" }))]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    await drain();
    const q3 = (await list()).json().data.filter((r: { quarter: string }) => r.quarter === "Q3");
    expect(q3).toHaveLength(1);
  });
});

describe("slip HTML escaping (stored XSS)", () => {
  const XSS = "<img src=x onerror=alert(1)>";
  it("an employee name, department and a component name carrying markup come out escaped in BOTH slip HTML routes, once", async () => {
    const runId = randomUUID();
    const slipId = randomUUID();
    await scoped(TENANT, async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
        VALUES (${runId}::uuid, ${TENANT}::uuid, ${"X/" + runId.slice(0, 8)}, '2003-03', ${randomUUID()}::uuid, 'disbursed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, total_deductions_minor, net_pay_minor, components, status, created_by, updated_by)
        VALUES (${slipId}::uuid, ${TENANT}::uuid, ${runId}::uuid, ${EMP.id}::uuid, ${"E<script>"}, 5000000, 5000000, 100, 4999900,
                ${JSON.stringify([{ code: "X", name: XSS, type: "earning", amountMinor: 5000000 }, { code: "Y", name: "A & B", type: "deduction", amountMinor: 100 }])}::jsonb,
                'paid', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    });
    hrms.nameOverride = XSS;
    try {
      for (const url of [`/v1/payroll/slips/${slipId}/pdf`, `/v1/payroll/slips/${slipId}/download`]) {
        const res = await app.inject({ method: "GET", url, headers: auth(["payroll_admin"]) });
        expect(res.statusCode, `${url} ${res.body}`).toBe(200);
        expect(res.body).toContain("&lt;img src=x onerror=alert(1)&gt;");
        expect(res.body).not.toContain("<img src=x");
        expect(res.body).not.toContain("<script>");
        expect(res.body).toContain("A &amp; B");
        expect(res.body).not.toContain("&amp;amp;");
        const cd = String(res.headers["content-disposition"] ?? "");
        expect(cd).not.toMatch(/[<>]/);
      }
    } finally {
      hrms.nameOverride = null;
    }
  });
});
