/**
 * fin-payroll-02 (finish wave) -- end to end against a REAL, migrated Postgres
 * (through 0063), through buildApp() and the real consumers on the memory
 * queue (wrapped in runWithTenant exactly as worker.ts does). Only the HRMS
 * boundary is stubbed.
 *
 * Covers GRATUITY-01/04 (rule config + separation), ARREARS-03 (maker-checker,
 * race, run gating), BONUS-02 (ceiling), TAX-DECLARATION-02/04/05 (landlord
 * PAN, effective caps, window), PERQUISITE-02/06 (audited lookup, delete).
 *
 * Requires DATABASE_URL pointing at your own disposable Postgres migrated
 * through 0063 (see vitest.config.ts REL-035).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";

const H = vi.hoisted(() => ({ employeeBasic: "1500000" }));
const EMPLOYEE = "71000000-4802-4000-8000-0000000000e1";
vi.mock("../src/shared/hrms-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  verifyEmployeeExists: vi.fn(async () => true),
  resolveActorEmployeeId: vi.fn(async () => EMPLOYEE),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
  fetchPayrollInput: vi.fn(async () => ({
    month: "2026-10",
    employees: [{ id: EMPLOYEE, employeeNo: "E1", fullName: "Test Employee", basicMinor: H.employeeBasic, pan: "ABCDE1234F", cityClass: "X", taxRegime: "new" }],
    lopDays: {}, overtimeHours: {},
  })),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerGratuityRuleConsumers } from "../src/modules/gratuity-rules/consumer.js";
import { registerArrearApprovalConsumers } from "../src/modules/arrears-approval/consumer.js";
import { decideArrear } from "../src/modules/arrears-approval/commands.js";
import { registerBonusRuleConsumers } from "../src/modules/bonus-rules/consumer.js";
import { registerTaxConsumers } from "../src/modules/tax/consumer.js";
import { registerPayrollConsumers, collectAdHocEarnings } from "../src/modules/payroll/consumer.js";
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { decryptPii, encryptPii } from "../src/shared/pii-crypto.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const CHECKER_2 = randomUUID();
const ADMIN = randomUUID();
const EMP_LOGIN = randomUUID();

const ADMIN_ROLES = ["payroll_admin"];
const OFFICER_ROLES = ["payroll_officer"];
const EMPLOYEE_ROLES = ["employee"];

function auth(sub: string, roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "fp02" }, SECRET)}` };
}

let app: Awaited<ReturnType<typeof buildApp>>;
const mq = () => queue as unknown as MemoryQueue;
const drain = () => mq().drain();
const audits: Array<{ tenantId: string; actorId: string; payload: Record<string, unknown> }> = [];

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>, tenant = TENANT) =>
  runWithTenant(tenant, () => db.transaction(fn));
const q = (text: ReturnType<typeof sql>, tenant = TENANT) =>
  withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => rowsOf(await tx.execute(text)));
const auditsFor = (resourceId: string) => audits.filter((a) => a.payload.resourceId === resourceId);

beforeAll(async () => {
  const raw = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    raw(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerGratuityRuleConsumers(queue);
  registerArrearApprovalConsumers(queue);
  registerBonusRuleConsumers(queue);
  registerTaxConsumers(queue);
  registerPayrollConsumers(queue);
  registerIntegrationConsumers(queue);
  // Audit events published straight to the queue (read-side audits).
  raw("audit.event.record", async (m) => {
    const e = m as unknown as { tenantId: string; actorId: string; payload: Record<string, unknown> };
    audits.push({ tenantId: e.tenantId, actorId: e.actorId, payload: e.payload });
  });
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await sqlClient.end();
});

// ── GRATUITY-01/04 ──────────────────────────────────────────────────────────
describe("gratuity rule config (GAP-PAYROLL-STATUTORY-GRATUITY-01/04)", () => {
  const body = { effectiveFrom: "2024-01-01", ruleSet: "ccs_dcrg", minServiceYears: 5, ceilingMinor: "250000000", changeReason: "Government Department edition: DCRG" };

  it("defaults to the Payment of Gratuity Act when nothing is configured", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gratuity/rules?asOf=2026-06-30", headers: auth(ADMIN, ADMIN_ROLES) });
    expect(res.statusCode).toBe(200);
    expect(res.json().resolved).toMatchObject({ ruleSet: "pog_act", source: "default", ceilingMinor: "200000000" });
    expect(res.json().suggested.ccs_dcrg.ceilingMinor).toBe("250000000");
  });

  it("only payroll_admin / super_admin may set it; others get 403", async () => {
    for (const roles of [OFFICER_ROLES, EMPLOYEE_ROLES, ["hr_admin"]]) {
      const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/gratuity/rules", headers: auth(MAKER, roles), payload: body });
      expect(res.statusCode).toBe(403);
    }
  });

  it("validates the body at the boundary", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/gratuity/rules", headers: auth(ADMIN, ADMIN_ROLES), payload: { ...body, ruleSet: "bogus" } });
    expect(res.statusCode).toBe(400);
    const short = await app.inject({ method: "POST", url: "/v1/payroll/statutory/gratuity/rules", headers: auth(ADMIN, ADMIN_ROLES), payload: { ...body, changeReason: "x" } });
    expect(short.statusCode).toBe(400);
  });

  it("persists via the consumer, audits before/after, rejects a duplicate date, and is tenant-scoped", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/gratuity/rules", headers: auth(ADMIN, ADMIN_ROLES), payload: body });
    expect(res.statusCode).toBe(202);
    await drain();
    const got = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gratuity/rules?asOf=2026-06-30", headers: auth(ADMIN, ADMIN_ROLES) });
    expect(got.json().resolved).toMatchObject({ ruleSet: "ccs_dcrg", source: "tenant", ceilingMinor: "250000000", effectiveFrom: "2024-01-01" });
    // a date before the effective date still resolves to the default
    const before = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gratuity/rules?asOf=2023-12-31", headers: auth(ADMIN, ADMIN_ROLES) });
    expect(before.json().resolved.ruleSet).toBe("pog_act");

    const trail = await q(sql`SELECT actor_id, payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'audit.event.record' AND payload->>'resourceType' = 'gratuity_rule_config'`);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.payload).toMatchObject({ action: "create", before: { ruleSet: "pog_act" }, after: { ruleSet: "ccs_dcrg" }, changeReason: body.changeReason });
    expect(trail[0]!.actor_id).toBe(ADMIN);

    const dup = await app.inject({ method: "POST", url: "/v1/payroll/statutory/gratuity/rules", headers: auth(ADMIN, ADMIN_ROLES), payload: body });
    expect(dup.statusCode).toBe(409);

    const other = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gratuity/rules?asOf=2026-06-30", headers: auth(ADMIN, ADMIN_ROLES, OTHER_TENANT) });
    expect(other.json().resolved.source).toBe("default");
  });

  it("a Govt Department separation with 22 completed years is computed as DCRG, not 15/26 x years", async () => {
    await asTenant((tx) => tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2000-01-01', 5000)`));
    const employeeId = randomUUID();
    await queue.publish("hrms.employee.separated", {
      messageId: randomUUID(), type: "hrms.employee.separated", tenantId: TENANT, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { employeeId, effectiveDate: "2026-06-30", dateOfJoining: "2004-06-30", basicMinor: "10000000", separationType: "retirement" },
    });
    await drain();
    const rows = await q(sql`SELECT gratuity_minor::text AS g FROM statutory.payroll_gratuity WHERE employee_id = ${employeeId}::uuid`);
    // emoluments = 1,00,000 + 50% DA = 1,50,000; 44 half-years x 1/4 = 11x => Rs 16,50,000
    // (the Payment of Gratuity Act would give 15/26 x 1,50,000 x 22 = Rs 19,03,846).
    expect(rows).toHaveLength(1);
    expect(rows[0]!.g).toBe("165000000");
  });
});

// ── ARREARS-03 ──────────────────────────────────────────────────────────────
describe("arrears maker-checker (GAP-PAYROLL-ARREARS-03)", () => {
  async function seedArrear(opts: { status?: string; createdBy?: string; source?: string } = {}): Promise<string> {
    const id = randomUUID();
    await asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_arrears (id, tenant_id, employee_id, component_code, from_period, to_period,
        old_amount_minor, new_amount_minor, difference_minor, reason, status, source, created_by)
      VALUES (${id}::uuid, ${TENANT}::uuid, ${EMPLOYEE}::uuid, 'DA', '2026-04', '2026-04', 100000, 150000, 50000, 'manual', ${opts.status ?? "pending"}, ${opts.source ?? "manual"}, ${opts.createdBy ?? MAKER}::uuid)`));
    return id;
  }
  const arrear = async (id: string) => (await q(sql`SELECT status, decided_by::text AS decided_by, decision_note FROM payroll.payroll_arrears WHERE id = ${id}::uuid`))[0]!;
  const decide = (id: string, action: string, sub: string, payload: Record<string, unknown> = {}, roles = OFFICER_ROLES) =>
    app.inject({ method: "POST", url: `/v1/payroll/arrears/${id}/${action}`, headers: auth(sub, roles), payload });

  it("approval is required by default and the policy endpoint says so", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/arrears/approval-policy", headers: auth(CHECKER, OFFICER_ROLES) });
    expect(res.json()).toMatchObject({ required: true, actorId: CHECKER });
  });

  it("a different payroll user approves; decided_by, note and an audit row are recorded", async () => {
    const id = await seedArrear();
    const res = await decide(id, "approve", CHECKER, { note: "checked against order" });
    expect(res.statusCode).toBe(202);
    await drain();
    expect(await arrear(id)).toMatchObject({ status: "approved", decided_by: CHECKER, decision_note: "checked against order" });
    const trail = await q(sql`SELECT actor_id, payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'resourceId' = ${id}`);
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actor_id: CHECKER });
    expect(trail[0]!.payload).toMatchObject({ action: "approve", resourceType: "payroll_arrear", differenceMinor: "50000" });
  });

  it("the creator cannot decide their own arrear: 403 and nothing changes", async () => {
    const id = await seedArrear({ createdBy: MAKER });
    const res = await decide(id, "approve", MAKER);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
    await drain();
    expect((await arrear(id)).status).toBe("pending");
  });

  it("a rejection needs a note; an employee cannot decide at all", async () => {
    const id = await seedArrear();
    expect((await decide(id, "reject", CHECKER, {})).statusCode).toBe(400);
    expect((await decide(id, "approve", CHECKER, {}, EMPLOYEE_ROLES)).statusCode).toBe(403);
    expect((await decide(id, "reject", CHECKER, { note: "duplicate of an earlier arrear" })).statusCode).toBe(202);
    await drain();
    expect(await arrear(id)).toMatchObject({ status: "rejected", decided_by: CHECKER });
  });

  it("an already-decided or unknown arrear is 409 / 404", async () => {
    const id = await seedArrear({ status: "approved" });
    expect((await decide(id, "approve", CHECKER)).statusCode).toBe(409);
    expect((await decide(randomUUID(), "approve", CHECKER)).statusCode).toBe(404);
  });

  it("race: two checkers decide the same pending arrear concurrently -> exactly one wins", async () => {
    const id = await seedArrear();
    const base = { type: COMMANDS.arrearDecide, tenantId: TENANT, correlationId: randomUUID(), schemaVersion: "1.0" };
    await Promise.all([
      queue.publish(COMMANDS.arrearDecide, { ...base, messageId: randomUUID(), actorId: CHECKER, payload: { tenantId: TENANT, id, decision: "approved" } }),
      queue.publish(COMMANDS.arrearDecide, { ...base, messageId: randomUUID(), actorId: CHECKER_2, payload: { tenantId: TENANT, id, decision: "rejected", note: "no" } }),
    ]);
    await drain();
    const row = await arrear(id);
    expect(["approved", "rejected"]).toContain(row.status);
    expect([CHECKER, CHECKER_2]).toContain(row.decided_by);
    const trail = await q(sql`SELECT payload->>'action' AS action FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'resourceId' = ${id}`);
    const actions = trail.map((r) => r.action).sort();
    expect(actions).toHaveLength(2);
    expect(actions).toContain("decide_refused"); // the loser is audited, not silent
  });

  it("a REFUSED attempt does not poison the arrear: the maker's refused decision, then a checker's approval, ends approved", async () => {
    const id = await seedArrear({ createdBy: MAKER });
    // the maker's decision reaches the consumer (bypassing the route pre-check, e.g. a policy flip race) and is refused ...
    await decideArrear({ tenantId: TENANT, actorId: MAKER, correlationId: randomUUID() } as never, { id, decision: "approved" });
    await drain();
    expect((await arrear(id)).status).toBe("pending");
    // ... and the same decision attempted again is still refused, never silently deduped into "done"
    await decideArrear({ tenantId: TENANT, actorId: MAKER, correlationId: randomUUID() } as never, { id, decision: "approved" });
    await drain();
    expect((await arrear(id)).status).toBe("pending");
    // a legitimate checker approves it
    expect((await decide(id, "approve", CHECKER)).statusCode).toBe(202);
    await drain();
    expect(await arrear(id)).toMatchObject({ status: "approved", decided_by: CHECKER });
    // every refusal was audited
    const refused = await q(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'resourceId' = ${id} AND payload->>'action'='decide_refused'`);
    expect(refused).toHaveLength(2);
  });

  it("consumer-level re-check: the creator's own decision command moves nothing", async () => {
    const id = await seedArrear({ createdBy: MAKER });
    await queue.publish(COMMANDS.arrearDecide, {
      messageId: randomUUID(), type: COMMANDS.arrearDecide, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, id, decision: "approved" },
    });
    await drain();
    expect((await arrear(id)).status).toBe("pending");
  });

  it("the payroll run pays only APPROVED manual arrears while approval is required (and revision arrears)", async () => {
    const tenant = randomUUID();
    const emp = randomUUID();
    const ins = (status: string, source: string, code: string) => asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period, to_period, old_amount_minor, new_amount_minor, difference_minor, status, source, created_by)
      VALUES (${tenant}::uuid, ${emp}::uuid, ${code}, '2026-03', '2026-03', 0, 0, 1000, ${status}, ${source}, ${MAKER}::uuid)`), tenant);
    await ins("pending", "manual", "PENDING_MANUAL");
    await ins("approved", "manual", "APPROVED_MANUAL");
    await ins("approved", "revision", "ARREAR");
    const collect = () => asTenant(async (tx) => (await collectAdHocEarnings(tx as never, tenant, emp, "2026-10")).arrearIds.length, tenant);
    expect(await collect()).toBe(2); // approved manual + approved revision; pending manual is NOT paid
    // the tenant switches approval OFF (legacy behaviour): pending is paid again
    await asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, arrears_approval_required) VALUES (${tenant}::uuid, false)`), tenant);
    expect(await collect()).toBe(3);
  });

  it("policy change: payroll_admin only, reason required, audited, and lets the creator approve", async () => {
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/arrears/approval-policy", headers: auth(CHECKER, OFFICER_ROLES), payload: { required: false, reason: "switching approval off" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/arrears/approval-policy", headers: auth(ADMIN, ADMIN_ROLES), payload: { required: false } })).statusCode).toBe(400);
    const res = await app.inject({ method: "PUT", url: "/v1/payroll/arrears/approval-policy", headers: auth(ADMIN, ADMIN_ROLES), payload: { required: false, reason: "small office, single payroll officer" } });
    expect(res.statusCode).toBe(202);
    await drain();
    expect((await app.inject({ method: "GET", url: "/v1/payroll/arrears/approval-policy", headers: auth(ADMIN, ADMIN_ROLES) })).json().required).toBe(false);
    const trail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'resourceType'='payroll_arrear_policy'`);
    expect(trail[0]!.payload).toMatchObject({ before: { required: true }, after: { required: false }, reason: "small office, single payroll officer" });
    const id = await seedArrear({ createdBy: MAKER });
    expect((await decide(id, "approve", MAKER)).statusCode).toBe(202);
    await drain();
    expect((await arrear(id)).status).toBe("approved");
    // restore for any later test
    await app.inject({ method: "PUT", url: "/v1/payroll/arrears/approval-policy", headers: auth(ADMIN, ADMIN_ROLES), payload: { required: true, reason: "restoring the default policy" } });
    await drain();
  });
});

// ── BONUS-02 ────────────────────────────────────────────────────────────────
describe("Payment of Bonus Act parameters (GAP-PAYROLL-BONUS-02)", () => {
  const bonusRows = () => q(sql`SELECT basic_minor::text AS basic, bonus_amount_minor::text AS amount FROM payroll.payroll_bonus WHERE employee_id = ${EMPLOYEE}::uuid ORDER BY created_at`);
  const compute = (basicMinor: number, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/payroll/bonus/compute", headers: auth(ADMIN, ADMIN_ROLES), payload: { employeeId: EMPLOYEE, fy: "2026-27", basicMinor, bonusPct: 8.33, ...extra } });

  it("with no rule the legacy amount (basic x pct) is unchanged", async () => {
    expect((await compute(1_500_000)).statusCode).toBe(202);
    await drain();
    expect((await bonusRows())[0]).toEqual({ basic: "1500000", amount: "124950" });
  });

  it("prefill endpoint returns the employee's current basic from the HRMS payroll input", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/bonus/basic?employeeId=${EMPLOYEE}`, headers: auth(ADMIN, ADMIN_ROLES) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ employeeId: EMPLOYEE, basicMinor: "1500000", source: "hrms_payroll_input" });
    expect((await app.inject({ method: "GET", url: `/v1/payroll/bonus/basic?employeeId=${randomUUID()}`, headers: auth(ADMIN, ADMIN_ROLES) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/payroll/bonus/basic?employeeId=${EMPLOYEE}`, headers: auth(EMP_LOGIN, EMPLOYEE_ROLES) })).statusCode).toBe(403);
  });

  it("a configured rule caps the wages the bonus is computed on and enforces eligibility", async () => {
    const set = await app.inject({
      method: "POST", url: "/v1/payroll/bonus/rules", headers: auth(ADMIN, ADMIN_ROLES),
      payload: { effectiveFrom: "2026-04-01", wageCeilingMinor: "700000", eligibilityCeilingMinor: "2100000", minBonusBps: 833, maxBonusBps: 2000, changeReason: "Payment of Bonus Act applies to this body" },
    });
    expect(set.statusCode).toBe(202);
    await drain();
    expect((await app.inject({ method: "GET", url: "/v1/payroll/bonus/rules", headers: auth(ADMIN, ADMIN_ROLES) })).json().resolved)
      .toMatchObject({ wageCeilingMinor: "700000", eligibilityCeilingMinor: "2100000", source: "tenant" });
    expect((await compute(1_500_000)).statusCode).toBe(202);
    await drain();
    const rows = await bonusRows();
    // wages capped at Rs 7,000: (700000 x 833 + 5000) / 10000 = 58,310 (not 124,950)
    expect(rows[1]).toEqual({ basic: "1500000", amount: "58310" });
    const tooHigh = await compute(2_100_001, { overrideReason: "basic above the HRMS value" });
    expect(tooHigh.statusCode).toBe(400);
    expect(tooHigh.json().code).toBe("BONUS_RULE_VIOLATION");
    const trail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'action'='compute' AND payload->>'wageCeilingApplied'='true'`);
    expect(trail.length).toBeGreaterThan(0);
  });
});

// ── TAX-DECLARATION-02/04/05 ────────────────────────────────────────────────
describe("tax declaration lifecycle (GAP-PAYROLL-TAX-DECLARATION-02/04/05)", () => {
  const FY = "2025-26";
  const declare = (roles: string[], sub: string, payload: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/payroll/tax-declarations", headers: auth(sub, roles),
      payload: { fy: FY, regime: "new", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 0, employeeId: EMPLOYEE, ...payload } });
  const getDeclaration = (roles = ADMIN_ROLES, sub = ADMIN) =>
    app.inject({ method: "GET", url: `/v1/payroll/tax-declarations?fy=${FY}&employeeId=${EMPLOYEE}`, headers: auth(sub, roles) });

  it("exposes the EFFECTIVE (tenant-resolved) 80C/80D/80CCD(1B) caps for client-side limits", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax-declarations/limits?fy=${FY}`, headers: auth(EMP_LOGIN, EMPLOYEE_ROLES) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fy: FY, sec80cCapMinor: expect.stringMatching(/^\d+$/), sec80dCapMinor: expect.stringMatching(/^\d+$/), sec80ccd1bCapMinor: expect.stringMatching(/^\d+$/) });
    expect(res.json().landlordPanRentThresholdMinor).toBe("10000000");
  });

  it("no window configured: always open (legacy); a window closes employee filing but not staff on-behalf filing", async () => {
    expect((await declare(EMPLOYEE_ROLES, EMP_LOGIN, { section80c: 100000 })).statusCode).toBe(202);
    await drain();
    // payroll_admin sets a window that closed long ago
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/tax-declarations/window", headers: auth(CHECKER, OFFICER_ROLES), payload: { fy: FY, closesOn: "2020-01-01", changeReason: "window for the financial year" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/tax-declarations/window", headers: auth(ADMIN, ADMIN_ROLES), payload: { fy: FY, closesOn: "2020-01-01", changeReason: "window for the financial year" } })).statusCode).toBe(202);
    await drain();
    const win = await app.inject({ method: "GET", url: `/v1/payroll/tax-declarations/window?fy=${FY}`, headers: auth(EMP_LOGIN, EMPLOYEE_ROLES) });
    expect(win.json()).toMatchObject({ configured: true, open: false, state: "closed", closesOn: "2020-01-01" });
    const closed = await declare(EMPLOYEE_ROLES, EMP_LOGIN, { section80c: 200000 });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe("DECLARATION_WINDOW_CLOSED");
    expect((await declare(ADMIN_ROLES, ADMIN, { section80c: 300000 })).statusCode).toBe(202);
    await drain();
    expect((await getDeclaration()).json().section80c).toBe(300000);
    // re-open: employees can file again
    await app.inject({ method: "PUT", url: "/v1/payroll/tax-declarations/window", headers: auth(ADMIN, ADMIN_ROLES), payload: { fy: FY, closesOn: "2099-12-31", changeReason: "extended by order dated today" } });
    await drain();
    expect((await declare(EMPLOYEE_ROLES, EMP_LOGIN, { section80c: 400000 })).statusCode).toBe(202);
    const trail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'resourceType'='tax_declaration_window'`);
    expect(trail.length).toBe(2);
    expect(trail[1]!.payload).toMatchObject({ action: "set_window", before: { closesOn: "2020-01-01" }, after: { closesOn: "2099-12-31" } });
  });

  it("records 'last updated' (resubmission moves it, created_at does not) and the landlord PAN masked on read", async () => {
    await drain();
    const first = (await getDeclaration()).json();
    expect(first.updatedAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect((await declare(ADMIN_ROLES, ADMIN, { regime: "new", section80c: 500000, landlordName: "A Landlord", landlordPan: "abcde1234f" })).statusCode).toBe(202);
    await drain();
    const second = (await getDeclaration()).json();
    expect(second.createdAt).toBe(first.createdAt);
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime());
    expect(second.landlordName).toBe("A Landlord");
    expect(second.landlordPanMasked).toMatch(/^ABCDE.*F$/);
    expect(second.landlordPanMasked).not.toBe("ABCDE1234F");
    // PAN stored as ciphertext at rest
    const raw = await q(sql`SELECT landlord_pan FROM payroll.payroll_tax_declarations WHERE employee_id = ${EMPLOYEE}::uuid AND fy = ${FY}`);
    expect(String(raw[0]!.landlord_pan)).toMatch(/^enc:/);
    // resubmitting without the PAN keeps it
    expect((await declare(ADMIN_ROLES, ADMIN, { section80c: 600000 })).statusCode).toBe(202);
    await drain();
    expect((await getDeclaration()).json().landlordPanMasked).toBe(second.landlordPanMasked);
    // malformed PAN is rejected at the boundary
    expect((await declare(ADMIN_ROLES, ADMIN, { landlordPan: "NOT-A-PAN" })).statusCode).toBe(400);
  });
});

// ── PERQUISITE-02/06 ────────────────────────────────────────────────────────
describe("Form 12BA lookups and component delete (GAP-PAYROLL-STATUTORY-PERQUISITE-02/06)", () => {
  const FY = "2026-27";
  let componentId = "";

  it("a staff lookup is audited with actor, employee and FY; an employee reading their own is not", async () => {
    const add = await app.inject({ method: "POST", url: "/v1/payroll/statutory/perquisite-components", headers: auth(ADMIN, ADMIN_ROLES),
      payload: { employeeId: EMPLOYEE, fy: FY, nature: "car", description: "Pool car", valueByEmployer: 1000, amountRecovered: 100 } });
    expect(add.statusCode).toBe(202);
    await drain();
    const before = audits.length;
    const staff = await app.inject({ method: "GET", url: `/v1/payroll/statutory/form12ba?employeeId=${EMPLOYEE}&fy=${FY}`, headers: auth(ADMIN, ADMIN_ROLES) });
    expect(staff.statusCode).toBe(200);
    await drain();
    expect(staff.json().perquisites[0]).toMatchObject({ nature: "car", id: expect.any(String), taxableValueMinor: 90000 });
    componentId = staff.json().perquisites[0].id;
    const seen = audits.slice(before).filter((a) => a.payload.action === "view_form12ba");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ actorId: ADMIN, tenantId: TENANT });
    expect(seen[0]!.payload).toMatchObject({ resourceId: EMPLOYEE, fy: FY, componentCount: 1 });
    const own = await app.inject({ method: "GET", url: `/v1/payroll/statutory/form12ba?fy=${FY}`, headers: auth(EMP_LOGIN, EMPLOYEE_ROLES) });
    expect(own.statusCode).toBe(200);
    await drain();
    expect(audits.slice(before).filter((a) => a.payload.action === "view_form12ba")).toHaveLength(1);
  });

  it("delete needs a reason and a payroll role, removes the line, and audits the values removed", async () => {
    const url = `/v1/payroll/statutory/perquisite-components/${componentId}/delete`;
    expect((await app.inject({ method: "POST", url, headers: auth(ADMIN, ADMIN_ROLES), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: auth(EMP_LOGIN, EMPLOYEE_ROLES), payload: { reason: "not mine to delete" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/payroll/statutory/perquisite-components/${randomUUID()}/delete`, headers: auth(ADMIN, ADMIN_ROLES), payload: { reason: "entered by mistake" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: auth(ADMIN, ADMIN_ROLES), payload: { reason: "entered by mistake" } })).statusCode).toBe(202);
    await drain();
    const left = await q(sql`SELECT 1 FROM payroll.perquisite_components WHERE id = ${componentId}::uuid`);
    expect(left).toHaveLength(0);
    const trail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'action'='delete' AND payload->>'resourceId' = ${componentId}`);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.payload).toMatchObject({ reason: "entered by mistake", nature: "car", valueByEmployerMinor: "100000", amountRecoveredMinor: "10000", taxableValueMinor: "90000" });
    // deleting again is a clean 404, not a second audit
    expect((await app.inject({ method: "POST", url, headers: auth(ADMIN, ADMIN_ROLES), payload: { reason: "entered by mistake" } })).statusCode).toBe(404);
  });
});

// ── STRUCTURES-03 ───────────────────────────────────────────────────────────
describe("component list exposes the configured rule (GAP-PAYROLL-STRUCTURES-03)", () => {
  it("returns formula / pctOfBasic / fixedMinor so the UI shows what is configured, never a hard-coded rate", async () => {
    const structureId = randomUUID();
    await asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, is_taxable, pct_of_basic, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${structureId}::uuid, 'HRA', 'House Rent Allowance', 'earning', true, 24.00, ${ADMIN}::uuid, ${ADMIN}::uuid)`));
    await asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, is_taxable, fixed_minor, formula, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${structureId}::uuid, 'CONV', 'Conveyance', 'earning', false, 160000, 'MIN(basic*0.1, 2500)', ${ADMIN}::uuid, ${ADMIN}::uuid)`));
    const res = await app.inject({ method: "GET", url: "/v1/payroll/components", headers: auth(ADMIN, ADMIN_ROLES) });
    expect(res.statusCode).toBe(200);
    const byCode = Object.fromEntries((res.json().data as Array<Record<string, unknown>>).map((c) => [c.code, c]));
    expect(byCode.HRA).toMatchObject({ pctOfBasic: "24.00", fixedMinor: null, formula: null, isTaxable: true });
    expect(byCode.CONV).toMatchObject({ pctOfBasic: null, fixedMinor: "160000", formula: "MIN(basic*0.1, 2500)" });
  });
});

// ── follow-up review fixes ──────────────────────────────────────────────────
describe("arrears grandfathering (migration 0061)", () => {
  // The migration's one-shot UPDATE, extracted verbatim from the file between its markers.
  const migration = readFileSync(new URL("../migrations/0061_gratuity_rule_config_arrears_approval.sql", import.meta.url), "utf8");
  const grandfatherSql = migration.slice(migration.indexOf("-- grandfather:begin") + "-- grandfather:begin".length, migration.indexOf("-- grandfather:end")).trim();

  const seed = async (tenant: string, status: string, source: string) => {
    const id = randomUUID();
    await asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_arrears (id, tenant_id, employee_id, component_code, from_period, to_period, old_amount_minor, new_amount_minor, difference_minor, status, source, created_by)
      VALUES (${id}::uuid, ${tenant}::uuid, ${EMPLOYEE}::uuid, 'DA', '2026-03', '2026-03', 0, 0, 1000, ${status}, ${source}, ${MAKER}::uuid)`), tenant);
    return id;
  };
  const row = async (tenant: string, id: string) => (await q(sql`SELECT status, decided_by::text AS decided_by, decision_note FROM payroll.payroll_arrears WHERE id = ${id}::uuid`, tenant))[0]!;

  it("the migration statement approves only pending MANUAL, unpaid arrears, leaving decided_by NULL; the next run pays them; a NEW manual arrear still needs a checker", async () => {
    const tenant = randomUUID();
    const preExisting = await seed(tenant, "pending", "manual");
    const alreadyPaidIn = await seed(tenant, "pending", "manual");
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_arrears SET run_id = ${randomUUID()}::uuid WHERE id = ${alreadyPaidIn}::uuid`), tenant);
    const rejected = await seed(tenant, "rejected", "manual");
    const revision = await seed(tenant, "pending", "revision");

    // (what the migration does on its first application; RLS is lifted there, here the tenant scope applies)
    await asTenant((tx) => tx.execute(sql.raw(grandfatherSql) as SQL), tenant);

    expect(await row(tenant, preExisting)).toEqual({ status: "approved", decided_by: null, decision_note: "grandfathered by migration 0061" });
    expect((await row(tenant, alreadyPaidIn)).status).toBe("pending");
    expect((await row(tenant, rejected)).status).toBe("rejected");
    expect((await row(tenant, revision)).status).toBe("pending");

    const emp = EMPLOYEE;
    const collect = () => asTenant(async (tx) => (await collectAdHocEarnings(tx as never, tenant, emp, "2026-10")).arrearIds, tenant);
    // gate still ON (no settings row): the grandfathered arrear is paid by the next run ...
    expect(await collect()).toEqual([preExisting]);
    // ... while an arrear created after the migration is not, until a checker approves it
    const fresh = await seed(tenant, "pending", "manual");
    expect(await collect()).toEqual([preExisting]);
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_arrears SET status = 'approved', decided_by = ${CHECKER}::uuid WHERE id = ${fresh}::uuid`), tenant);
    expect((await collect()).sort()).toEqual([preExisting, fresh].sort());
  });

  it("the migration seeds no settings row and guards the statement to the first application", () => {
    expect(migration).not.toMatch(/INSERT INTO payroll\.payroll_settings/i);
    expect(migration).toMatch(/column_name = 'decided_at'/);
    expect(migration).toMatch(/FORCE ROW LEVEL SECURITY;\s*END IF;/);
  });
});

describe("perquisite upsert audit records the row actually written (review fix 2)", () => {
  it("an overwrite audits the EXISTING row id with before/after values, not the command's new id", async () => {
    const fy = "2027-28";
    const post = (value: number) => app.inject({ method: "POST", url: "/v1/payroll/statutory/perquisite-components", headers: auth(ADMIN, ADMIN_ROLES),
      payload: { employeeId: EMPLOYEE, fy, nature: "medical", description: "v", valueByEmployer: value, amountRecovered: 0 } });
    expect((await post(1000)).statusCode).toBe(202);
    await drain();
    const first = await q(sql`SELECT id::text AS id FROM payroll.perquisite_components WHERE employee_id = ${EMPLOYEE}::uuid AND fy = ${fy} AND nature = 'medical'`);
    const rowId = String(first[0]!.id);
    expect((await post(2500)).statusCode).toBe(202);
    await drain();
    const after = await q(sql`SELECT id::text AS id, taxable_value_minor::text AS t FROM payroll.perquisite_components WHERE employee_id = ${EMPLOYEE}::uuid AND fy = ${fy} AND nature = 'medical'`);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: rowId, t: "250000" });
    const trail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'resourceType'='perquisite_component' AND payload->>'fy' = ${fy} ORDER BY created_at`);
    expect(trail).toHaveLength(2);
    expect(trail[0]!.payload).toMatchObject({ action: "create", resourceId: rowId, before: null, after: { taxableValueMinor: "100000" } });
    expect(trail[1]!.payload).toMatchObject({ action: "update", resourceId: rowId, before: { taxableValueMinor: "100000" }, after: { taxableValueMinor: "250000" } });
  });
});

describe("bonus basic is verified server-side (review fix 3)", () => {
  const compute = (basicMinor: number, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/payroll/bonus/compute", headers: auth(ADMIN, ADMIN_ROLES), payload: { employeeId: EMPLOYEE, fy: "2026-27", basicMinor, bonusPct: 8.33, ...extra } });

  it("a basic that differs from the HRMS basic is refused without a reason, and accepted + audited with one", async () => {
    H.employeeBasic = "1500000";
    const refused = await compute(1_400_000);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe("BONUS_OVERRIDE_REASON_REQUIRED");
    const ok = await compute(1_400_000, { overrideReason: "pay level fixed from 1 April" });
    expect(ok.statusCode).toBe(202);
    await drain();
    const trail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic='audit.event.record' AND payload->>'basicOverrideReason' = 'pay level fixed from 1 April'`);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.payload).toMatchObject({ hrmsBasicMinor: "1500000", submittedBasicMinor: "1400000" });
  });

  it("a matching basic needs no reason", async () => {
    H.employeeBasic = "1500000";
    expect((await compute(1_500_000)).statusCode).toBe(202);
  });

  it("understating the basic cannot dodge the eligibility ceiling: the HRMS basic is checked too", async () => {
    // rule from the earlier bonus test: eligibility ceiling Rs 21,000 / month
    H.employeeBasic = "3000000";
    const res = await compute(1_000_000, { overrideReason: "claimed lower basic to stay eligible" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("BONUS_RULE_VIOLATION");
    H.employeeBasic = "1500000";
  });
});

describe("landlord PAN (review fix 6)", () => {
  const FY6 = "2025-26";
  const declare = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/payroll/tax-declarations", headers: auth(ADMIN, ADMIN_ROLES),
    payload: { fy: FY6, regime: "old", employeeId: EMPLOYEE, section80c: 0, section80d: 0, otherDeductions: 0, ...payload } });

  it("annual rent above Rs 1,00,000 needs a landlord PAN server-side; at the threshold it does not", async () => {
    const tenantEmployee = randomUUID();
    const missing = await app.inject({ method: "POST", url: "/v1/payroll/tax-declarations", headers: auth(ADMIN, ADMIN_ROLES),
      payload: { fy: FY6, regime: "old", employeeId: tenantEmployee, rentPaidMinor: 10_000_001, section80c: 0, section80d: 0, otherDeductions: 0 } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("LANDLORD_PAN_REQUIRED");
    const atThreshold = await app.inject({ method: "POST", url: "/v1/payroll/tax-declarations", headers: auth(ADMIN, ADMIN_ROLES),
      payload: { fy: FY6, regime: "new", employeeId: tenantEmployee, rentPaidMinor: 10_000_000, section80c: 0, section80d: 0, otherDeductions: 0 } });
    expect(atThreshold.statusCode).toBe(202);
  });

  it("the PAN is sealed before it is published: the queue command carries ciphertext only, and it round-trips", async () => {
    const published: unknown[] = [];
    const spy = vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: unknown) => { if (topic === COMMANDS.taxDeclarationSubmit) published.push(msg); return undefined as never; });
    try {
      const res = await declare({ regime: "new", rentPaidMinor: 0, landlordPan: "abcde1234f" });
      expect(res.statusCode).toBe(202);
    } finally { spy.mockRestore(); }
    expect(published).toHaveLength(1);
    const wire = JSON.stringify(published[0]);
    expect(wire).not.toMatch(/ABCDE1234F/i);
    const payload = (published[0] as { payload: { landlordPanSealed: string; landlordPan?: string } }).payload;
    expect(payload.landlordPan).toBeUndefined();
    expect(payload.landlordPanSealed).toMatch(/^enc:/);
    expect(decryptPii(payload.landlordPanSealed)).toBe("ABCDE1234F");
  });

  it("a PAN already on file satisfies the rule on a later high-rent resubmission", async () => {
    const onFile = randomUUID();
    await asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_tax_declarations (tenant_id, employee_id, fy, regime, created_by, landlord_pan)
      VALUES (${TENANT}::uuid, ${onFile}::uuid, ${FY6}, 'new', ${ADMIN}::uuid, ${encryptPii("ABCDE1234F")})`));
    const res = await app.inject({ method: "POST", url: "/v1/payroll/tax-declarations", headers: auth(ADMIN, ADMIN_ROLES),
      payload: { fy: FY6, regime: "old", employeeId: onFile, rentPaidMinor: 13_000_000, section80c: 0, section80d: 0, otherDeductions: 0 } });
    expect(res.statusCode).toBe(202);
  });
});

describe("CCS DCRG separation types (review fix 5)", () => {
  it("a resignation of a Govt Department employee gets no DCRG row", async () => {
    const employeeId = randomUUID();
    await queue.publish("hrms.employee.separated", {
      messageId: randomUUID(), type: "hrms.employee.separated", tenantId: TENANT, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { employeeId, effectiveDate: "2026-06-30", dateOfJoining: "2004-06-30", basicMinor: "10000000", separationType: "resignation" },
    });
    await drain();
    expect(await q(sql`SELECT 1 FROM statutory.payroll_gratuity WHERE employee_id = ${employeeId}::uuid`)).toHaveLength(0);
  });
});
