/**
 * fp-finance-01: maker-checker change requests (real Postgres).
 *
 *  - GAP-FINANCE-FISCAL-YEARS-01/-02  create-as-draft, open-period block, second-approver activation
 *  - GAP-FINANCE-OPENING-BALANCES-01  pending batch + approve/reject
 *  - GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01  HoA change held for a different officer
 *
 * Routes publish to the shared (memory) queue; the spy captures each envelope and
 * `deliver()` feeds it to the real consumers on a tenant-wrapped MemoryQueue, the
 * same shape as production's worker.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { setFinanceSettings, clearFinanceSettings } from "./_finance-settings.js";
import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { registerApprovalsConsumers } from "../src/modules/approvals/consumer.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = "00000000-aaaa-4000-8000-0000000fb101";
const CHECKER = "00000000-aaaa-4000-8000-0000000fb102";
const CHECKER2 = "00000000-aaaa-4000-8000-0000000fb103";
const HEAD_A = "aaaaaaaa-5555-4000-8000-0000000fb101";
const HEAD_B = "aaaaaaaa-5555-4000-8000-0000000fb102";
const HOA_OLD = "210100101010101010";
const HOA_NEW = "210100101010101011";

const as = (sub: string, roles = ["finance_admin"]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: `s-${sub.slice(-3)}` }, SECRET)}`,
});

type Sent = { topic: string; env: Record<string, unknown> & { messageId: string; actorId: string } };
let sent: Sent[] = [];

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

/** Deliver everything the routes published so far (optionally one topic) to the real consumers. */
async function deliver(topic?: string): Promise<MemoryQueue> {
  const q = tenantWrappedQueue();
  registerMastersConsumers(q);
  registerApprovalsConsumers(q);
  await q.start();
  const batch = sent.filter((s) => !topic || s.topic === topic);
  sent = sent.filter((s) => !batch.includes(s));
  for (const b of batch) await q.publish(b.topic, b.env as never);
  await q.drain();
  return q;
}

async function inject(method: "GET" | "POST" | "PATCH" | "PUT", url: string, headers: Record<string, string>, payload?: unknown) {
  const app = await buildApp();
  try {
    return await app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  } finally { await app.close(); }
}

async function rows<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r: any = await scoped(TENANT, (tx) => tx.execute(query));
  return (Array.isArray(r) ? r : r.rows ?? []) as T[];
}
const fyStatus = async () => Object.fromEntries((await rows<{ code: string; status: string }>(
  sql`SELECT code, status FROM gl.finance_fiscal_years WHERE tenant_id = ${TENANT}::uuid`)).map((r) => [r.code, r.status]));
const request = async (id: string) => (await rows<Record<string, any>>(
  sql`SELECT * FROM gl.finance_change_requests WHERE id = ${id}::uuid`))[0]!;
const audits = async (action: string) => rows<{ payload: any }>(
  sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND payload->>'action' = ${action}`);

async function cleanup() {
  await clearFinanceSettings(TENANT);
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_fiscal_years WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_period_close WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_opening_balances WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM budget.finance_heads WHERE tenant_id = ${TENANT}::uuid`));
}

/** Hard-close every month of FY 2031-32 (Apr 2031 .. Mar 2032). */
async function hardCloseFy() {
  const months = Array.from({ length: 12 }, (_, i) => `${i < 9 ? 2031 : 2032}-${String(((i + 3) % 12) + 1).padStart(2, "0")}`);
  for (const p of months) {
    await scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO gl.finance_period_close (tenant_id, fiscal_year, period, status, created_by)
      VALUES (${TENANT}::uuid, '2031-32', ${p}, 'hard_close', ${MAKER}::uuid)
      ON CONFLICT (tenant_id, fiscal_year, period) DO UPDATE SET status = 'hard_close'`));
  }
}

beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: HEAD_A, tenantId: TENANT, code: "FP1-1100", name: "Cash", level: 1, classification: "asset", hoaCode: HOA_OLD, createdBy: MAKER, updatedBy: MAKER },
    { id: HEAD_B, tenantId: TENANT, code: "FP1-3100", name: "Capital", level: 1, classification: "equity", createdBy: MAKER, updatedBy: MAKER },
  ]));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_fiscal_years (id, tenant_id, code, label, start_date, end_date, status, created_by)
    VALUES (gen_random_uuid(), ${TENANT}::uuid, '2031-32', 'FY 2031-32', '2031-04-01', '2032-03-31', 'active', ${MAKER}::uuid)`));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });
afterEach(() => { vi.restoreAllMocks(); });

function captureQueue() {
  sent = [];
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, env: any) => { sent.push({ topic, env }); return undefined as never; });
}

describe("fiscal year: create as draft, activate through a second officer", () => {
  it("a year created while another is active lands as DRAFT and closes nothing", async () => {
    captureQueue();
    const res = await inject("POST", "/v1/finance/fiscal-years", as(MAKER), {
      code: "2032-33", label: "FY 2032-33", startDate: "2032-04-01", endDate: "2033-03-31", reason: "Next year entered early",
    });
    expect(res.statusCode).toBe(202);
    await deliver();
    expect(await fyStatus()).toEqual({ "2031-32": "active", "2032-33": "draft" });
  });

  it("activation is refused (409) while the outgoing year has months that are not hard-closed", async () => {
    captureQueue();
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2032-33/activate", as(MAKER), { reason: "Year-end rollover approved" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FY_OPEN_PERIODS");
    expect(sent).toHaveLength(0);
  });

  let requestId = "";
  it("with periods hard-closed, activation becomes a PENDING request: nothing changes yet", async () => {
    await hardCloseFy();
    captureQueue();
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2032-33/activate", as(MAKER), { reason: "Year-end rollover approved" });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("pending_approval");
    requestId = res.json().id;
    expect(sent.map((s) => s.topic)).toEqual([COMMANDS.changeRequestSubmit]);
    await deliver();
    expect(await fyStatus()).toEqual({ "2031-32": "active", "2032-33": "draft" });
    const r = await request(requestId);
    expect(r).toMatchObject({ status: "pending", kind: "fiscal_year_activate", subject_key: "2032-33", requested_by: MAKER });
    expect((await audits("change_request_submitted")).length).toBeGreaterThan(0);
  });

  it("a second request for the same year while one is pending -> 409", async () => {
    captureQueue();
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2032-33/activate", as(CHECKER), { reason: "Duplicate attempt here" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CHANGE_REQUEST_PENDING");
  });

  it("the maker cannot approve their own request (route 409; and a hand-published decision is rejected by the consumer)", async () => {
    captureQueue();
    const res = await inject("POST", `/v1/finance/change-requests/${requestId}/approve`, as(MAKER), {});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect(sent).toHaveLength(0);

    // Bypass the route: publish the decision command as the maker. The consumer enforces it too.
    sent = [{
      topic: COMMANDS.changeRequestDecide,
      env: {
        messageId: randomUUID(), type: COMMANDS.changeRequestDecide, tenantId: TENANT, actorId: MAKER,
        correlationId: randomUUID(), schemaVersion: "1.0", payload: { requestId, tenantId: TENANT, decision: "approve", note: null },
      },
    }];
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    expect((await request(requestId)).status).toBe("pending");
    expect(await fyStatus()).toEqual({ "2031-32": "active", "2032-33": "draft" });
  });

  it("only finance_admin/super_admin can decide", async () => {
    const res = await inject("POST", `/v1/finance/change-requests/${requestId}/approve`, as(CHECKER, ["finance_officer"]), {});
    expect(res.statusCode).toBe(403);
  });

  it("two checkers approving at once: exactly one decision applies, the other is rejected", async () => {
    captureQueue();
    const [a, b] = await Promise.all([
      inject("POST", `/v1/finance/change-requests/${requestId}/approve`, as(CHECKER), { note: "ok" }),
      inject("POST", `/v1/finance/change-requests/${requestId}/approve`, as(CHECKER2), { note: "ok too" }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(sent).toHaveLength(2);
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    const r = await request(requestId);
    expect(r.status).toBe("approved");
    expect([CHECKER, CHECKER2]).toContain(r.decided_by);
    expect(await fyStatus()).toEqual({ "2031-32": "closed", "2032-33": "active" });
    const applied = (await audits("activate_fiscal_year")).filter((a2) => a2.payload.changeRequestId === requestId);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.payload).toMatchObject({ reason: "Year-end rollover approved", closedFiscalYears: ["2031-32"] });
  });

  it("an approval whose rule no longer holds is recorded as a rejection, not left stuck", async () => {
    // New draft + request, then un-close a month before the checker approves.
    await scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO gl.finance_fiscal_years (id, tenant_id, code, label, start_date, end_date, status, created_by)
      VALUES (gen_random_uuid(), ${TENANT}::uuid, '2033-34', 'FY 2033-34', '2033-04-01', '2034-03-31', 'draft', ${MAKER}::uuid)`));
    const months = Array.from({ length: 12 }, (_, i) => `${i < 9 ? 2032 : 2033}-${String(((i + 3) % 12) + 1).padStart(2, "0")}`);
    for (const p of months) {
      await scoped(TENANT, (tx) => tx.execute(sql`
        INSERT INTO gl.finance_period_close (tenant_id, fiscal_year, period, status, created_by)
        VALUES (${TENANT}::uuid, '2032-33', ${p}, 'hard_close', ${MAKER}::uuid) ON CONFLICT (tenant_id, fiscal_year, period) DO NOTHING`));
    }
    captureQueue();
    const created = await inject("PATCH", "/v1/finance/fiscal-years/2033-34/activate", as(MAKER), { reason: "Next rollover approved" });
    expect(created.statusCode).toBe(202);
    await deliver();
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_period_close WHERE tenant_id = ${TENANT}::uuid AND period = '2033-01'`));
    captureQueue();
    const approve = await inject("POST", `/v1/finance/change-requests/${created.json().id}/approve`, as(CHECKER), {});
    expect(approve.statusCode).toBe(202);
    const q = await deliver();
    expect(q.dlq.length).toBe(0);
    const r = await request(created.json().id);
    expect(r.status).toBe("rejected");
    expect(r.decision_note).toMatch(/Not applied: .*FY_OPEN_PERIODS/);
    expect((await fyStatus())["2033-34"]).toBe("draft");
  });

  it("reject needs a note and leaves the year untouched; the maker can withdraw their own request", async () => {
    captureQueue();
    const raised = await inject("PATCH", "/v1/finance/fiscal-years/2031-32/activate", as(MAKER), { reason: "Go back to the prior year" });
    // 2031-32 is closed now, its months are hard-closed, and the outgoing year (2032-33) has open months -> blocked
    expect(raised.statusCode).toBe(409);

    // use the 2033-34 draft: withdraw path
    await scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO gl.finance_period_close (tenant_id, fiscal_year, period, status, created_by)
      VALUES (${TENANT}::uuid, '2032-33', '2033-01', 'hard_close', ${MAKER}::uuid) ON CONFLICT (tenant_id, fiscal_year, period) DO NOTHING`));
    const again = await inject("PATCH", "/v1/finance/fiscal-years/2033-34/activate", as(MAKER), { reason: "Raising it once more" });
    expect(again.statusCode).toBe(202);
    await deliver();
    const noNote = await inject("POST", `/v1/finance/change-requests/${again.json().id}/reject`, as(CHECKER), {});
    expect(noNote.statusCode).toBe(400);
    const notMine = await inject("POST", `/v1/finance/change-requests/${again.json().id}/cancel`, as(CHECKER), {});
    expect(notMine.statusCode).toBe(403);
    captureQueue();
    const cancel = await inject("POST", `/v1/finance/change-requests/${again.json().id}/cancel`, as(MAKER), {});
    expect(cancel.statusCode).toBe(202);
    await deliver();
    expect((await request(again.json().id)).status).toBe("cancelled");
    expect((await fyStatus())["2033-34"]).toBe("draft");
  });

  it("with the second-approver setting OFF the officer activates directly", async () => {
    await setFinanceSettings(TENANT, { makerCheckerEnabled: false, blockFyActivationOpenPeriods: false });
    captureQueue();
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2033-34/activate", as(MAKER), { reason: "Direct activation by policy" });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(sent.map((s) => s.topic)).toEqual([COMMANDS.fiscalYearActivate]);
    await deliver();
    expect((await fyStatus())["2033-34"]).toBe("active");
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${TENANT}::uuid`));
  });
});

describe("opening balances through a second officer", () => {
  const entries = [
    { accountCode: "FP1-1100", debitMinor: "500000", creditMinor: "0" },
    { accountCode: "FP1-3100", debitMinor: "0", creditMinor: "500000" },
  ];
  it("holds the batch as pending, posts nothing, then posts it when a different officer approves", async () => {
    captureQueue();
    const res = await inject("POST", "/v1/finance/opening-balances", as(MAKER), { fyCode: "2033-34", entries, reason: "Migration per audited TB" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "pending_approval", count: 2 });
    await deliver();
    expect(await rows(sql`SELECT 1 FROM gl.finance_opening_balances WHERE tenant_id = ${TENANT}::uuid AND fy_code = '2033-34'`)).toHaveLength(0);

    captureQueue();
    const approve = await inject("POST", `/v1/finance/change-requests/${res.json().id}/approve`, as(CHECKER), {});
    expect(approve.statusCode).toBe(202);
    await deliver();
    const ob = await rows<{ account_code: string; debit_minor: string; credit_minor: string }>(
      sql`SELECT account_code, debit_minor::text, credit_minor::text FROM gl.finance_opening_balances WHERE tenant_id = ${TENANT}::uuid AND fy_code = '2033-34' ORDER BY account_code`);
    expect(ob).toEqual([
      { account_code: "FP1-1100", debit_minor: "500000", credit_minor: "0" },
      { account_code: "FP1-3100", debit_minor: "0", credit_minor: "500000" },
    ]);
    expect((await request(res.json().id)).status).toBe("approved");
    expect((await audits("enter_opening_balances")).some((a) => a.payload.changeRequestId === res.json().id)).toBe(true);
  });

  it("a rejected batch posts nothing and can be raised again (fresh message id)", async () => {
    captureQueue();
    const first = await inject("POST", "/v1/finance/opening-balances", as(MAKER), {
      fyCode: "2034-35", entries, reason: "First attempt, wrong amounts",
    });
    expect(first.statusCode).toBe(202);
    await deliver();
    captureQueue();
    const rej = await inject("POST", `/v1/finance/change-requests/${first.json().id}/reject`, as(CHECKER), { note: "Amounts do not match TB" });
    expect(rej.statusCode).toBe(202);
    await deliver();
    expect((await request(first.json().id)).status).toBe("rejected");
    expect(await rows(sql`SELECT 1 FROM gl.finance_opening_balances WHERE tenant_id = ${TENANT}::uuid AND fy_code = '2034-35'`)).toHaveLength(0);
    captureQueue();
    const second = await inject("POST", "/v1/finance/opening-balances", as(MAKER), { fyCode: "2034-35", entries, reason: "Corrected amounts now" });
    expect(second.statusCode).toBe(202);
    expect(second.json().id).not.toBe(first.json().id);
    await deliver();
    expect((await request(second.json().id)).status).toBe("pending");
  });
});

describe("HoA code change through a second officer", () => {
  it("holds the change, then applies it with old/new on the audit event once approved", async () => {
    captureQueue();
    const res = await inject("PATCH", `/v1/finance/accounts/${HEAD_A}/hoa`, as(MAKER, ["finance_officer"]), { hoaCode: HOA_NEW, reason: "PFMS mapping circular" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "pending_approval", hoaCode: HOA_NEW });
    await deliver();
    expect((await rows<{ hoa_code: string }>(sql`SELECT hoa_code FROM budget.finance_heads WHERE id = ${HEAD_A}::uuid`))[0]!.hoa_code).toBe(HOA_OLD);

    captureQueue();
    const approve = await inject("POST", `/v1/finance/change-requests/${res.json().requestId}/approve`, as(CHECKER), {});
    expect(approve.statusCode).toBe(202);
    await deliver();
    expect((await rows<{ hoa_code: string }>(sql`SELECT hoa_code FROM budget.finance_heads WHERE id = ${HEAD_A}::uuid`))[0]!.hoa_code).toBe(HOA_NEW);
    const a = (await audits("head_hoa_changed")).find((x) => x.payload.details.changeRequestId === res.json().requestId)!;
    expect(a.payload.details).toMatchObject({ oldHoaCode: HOA_OLD, newHoaCode: HOA_NEW, reason: "PFMS mapping circular" });
  });
});

describe("settings + listing", () => {
  it("GET /settings returns the defaults for a tenant with no row", async () => {
    const res = await inject("GET", "/v1/finance/settings", as(MAKER));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      makerCheckerEnabled: true, blockFyActivationOpenPeriods: true, requireOpeningBalancesForActivation: false, fyCreateAsDraft: true,
    });
  });

  it("PUT /settings needs a reason, then an admin's change is applied and audited", async () => {
    const bad = await inject("PUT", "/v1/finance/settings", as(MAKER), { makerCheckerEnabled: false });
    expect(bad.statusCode).toBe(400);
    const denied = await inject("PUT", "/v1/finance/settings", as(MAKER, ["finance_officer"]), { makerCheckerEnabled: false, reason: "Single officer office" });
    expect(denied.statusCode).toBe(403);
    captureQueue();
    const ok = await inject("PUT", "/v1/finance/settings", as(MAKER), { requireOpeningBalancesForActivation: true, reason: "Rollover rule agreed with CFO" });
    expect(ok.statusCode).toBe(202);
    await deliver();
    const after = await inject("GET", "/v1/finance/settings", as(CHECKER));
    expect(after.json()).toMatchObject({ requireOpeningBalancesForActivation: true, makerCheckerEnabled: true });
    expect((await audits("update_finance_settings")).at(-1)!.payload).toMatchObject({ reason: "Rollover rule agreed with CFO" });
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${TENANT}::uuid`));
  });

  // Review fix: relaxing a control is itself a two-person change
  it("a single admin switching the second-approver rule OFF only raises a request: settings are unchanged until a DIFFERENT admin approves", async () => {
    captureQueue();
    const res = await inject("PUT", "/v1/finance/settings", as(MAKER), { makerCheckerEnabled: false, reason: "Single officer office" });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("pending_approval");
    expect(sent.map((s) => s.topic)).toEqual([COMMANDS.changeRequestSubmit]);
    await deliver();
    expect((await inject("GET", "/v1/finance/settings", as(MAKER))).json().makerCheckerEnabled).toBe(true);
    const id = res.json().id as string;
    expect(await request(id)).toMatchObject({ kind: "settings_relax", status: "pending", requested_by: MAKER });

    // the maker cannot approve it, even though maker-checker is the very thing being relaxed
    captureQueue();
    const self = await inject("POST", `/v1/finance/change-requests/${id}/approve`, as(MAKER), {});
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");

    captureQueue();
    expect((await inject("POST", `/v1/finance/change-requests/${id}/approve`, as(CHECKER), {})).statusCode).toBe(202);
    await deliver();
    expect((await request(id)).status).toBe("approved");
    expect((await inject("GET", "/v1/finance/settings", as(MAKER))).json().makerCheckerEnabled).toBe(false);
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${TENANT}::uuid`));
  });

  it("with maker-checker already OFF, relaxing another control still needs a distinct approver (enforced in the consumer too)", async () => {
    await setFinanceSettings(TENANT, { makerCheckerEnabled: false });
    captureQueue();
    const res = await inject("PUT", "/v1/finance/settings", as(MAKER), { blockFyActivationOpenPeriods: false, reason: "Rollover rule relaxed" });
    expect(res.json().status).toBe("pending_approval");
    await deliver();
    const id = res.json().id as string;
    sent = [{ topic: COMMANDS.changeRequestDecide, env: { messageId: randomUUID(), type: COMMANDS.changeRequestDecide, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0", payload: { requestId: id, tenantId: TENANT, decision: "approve", note: null } } }];
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    expect((await request(id)).status).toBe("pending");
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${TENANT}::uuid`));
  });

  it("turning a control ON stays a direct change", async () => {
    await setFinanceSettings(TENANT, { requireOpeningBalancesForActivation: false });
    captureQueue();
    const res = await inject("PUT", "/v1/finance/settings", as(MAKER), { requireOpeningBalancesForActivation: true, reason: "Tighten the rollover rule" });
    expect(res.json().status).toBe("accepted");
    await deliver();
    expect((await inject("GET", "/v1/finance/settings", as(MAKER))).json().requireOpeningBalancesForActivation).toBe(true);
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${TENANT}::uuid`));
  });

  it("with the second-approver setting OFF the HoA change is published and applied by the consumer, not written in the request", async () => {
    await setFinanceSettings(TENANT, { makerCheckerEnabled: false });
    captureQueue();
    const res = await inject("PATCH", `/v1/finance/accounts/${HEAD_B}/hoa`, as(MAKER, ["finance_officer"]), { hoaCode: HOA_NEW, reason: "PFMS mapping circular" });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect((await rows<{ hoa_code: string | null }>(sql`SELECT hoa_code FROM budget.finance_heads WHERE id = ${HEAD_B}::uuid`))[0]!.hoa_code).toBeNull();
    expect(sent.map((s) => s.topic)).toEqual([COMMANDS.hoaChangeApply]);
    await deliver();
    expect((await rows<{ hoa_code: string }>(sql`SELECT hoa_code FROM budget.finance_heads WHERE id = ${HEAD_B}::uuid`))[0]!.hoa_code).toBe(HOA_NEW);
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${TENANT}::uuid`));
  });

  it("the database refuses a second active fiscal year for a tenant (partial unique index backstop)", async () => {
    await expect(scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO gl.finance_fiscal_years (id, tenant_id, code, label, start_date, end_date, status, created_by)
      VALUES (gen_random_uuid(), ${TENANT}::uuid, '2099-00', 'dup', '2099-04-01', '2100-03-31', 'active', ${MAKER}::uuid)`))).rejects.toThrow();
  });

  it("GET /change-requests is bounded, filtered and carries a total", async () => {
    const all = await inject("GET", "/v1/finance/change-requests?limit=2", as(CHECKER));
    expect(all.statusCode).toBe(200);
    expect(all.json().data.length).toBeLessThanOrEqual(2);
    expect(all.json().total).toBeGreaterThan(2);
    const pending = await inject("GET", "/v1/finance/change-requests?status=pending&kind=opening_balances_enter", as(CHECKER));
    expect(pending.json().data.every((r: { status: string; kind: string }) => r.status === "pending" && r.kind === "opening_balances_enter")).toBe(true);
    const tooBig = await inject("GET", "/v1/finance/change-requests?limit=5000", as(CHECKER));
    expect(tooBig.statusCode).toBe(400);
    const otherTenant = await app2();
    expect(otherTenant).toBe(0);
  });
});

async function app2(): Promise<number> {
  const other = randomUUID();
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: "GET", url: "/v1/finance/change-requests",
      headers: { authorization: `Bearer ${signToken({ sub: MAKER, tid: other, roles: ["finance_admin"], sid: "sx" }, SECRET)}` },
    });
    return (res.json().data as unknown[]).length;
  } finally { await app.close(); }
}

void db;
