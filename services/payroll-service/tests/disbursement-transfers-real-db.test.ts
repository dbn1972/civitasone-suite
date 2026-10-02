/**
 * GAP-PAYROLL-DISBURSEMENT-TRANSFERS -- transfer ledger, real Postgres.
 *
 * payroll.disbursement_transfers / disbursement_file_issuances /
 * nach_return_files (migration 0053) and every writer:
 *   - POST /v1/payroll/runs/:id/bank-file: issuance + ledger rows for exactly
 *     the lines in the file + audit, in one transaction under a per-run lock.
 *     First file = all payable slips; later files = never-sent + queued
 *     retries only (409 NOTHING_TO_ISSUE / REISSUE_WOULD_DUPLICATE_PAYMENT
 *     otherwise); audited admin-only full re-issue; exception slips excluded;
 *     LEDGER_MISMATCH; concurrent clicks;
 *   - POST /v1/payroll/runs/:id/nach-return: file-aware matching, duplicate
 *     upload rejection, success->returned reversal audit;
 *   - GET /v1/payroll/disbursement/transfers (scoping, filters, masking);
 *   - POST .../:id/retry (409s, idempotency key, races, audit);
 *   - POST .../:id/reconcile (manual outcome for non-NACH rows, audited).
 *
 * Retry/reconcile/NACH-return are CQRS (route pre-check + command; consumer
 * writes ledger + audit in one tx), so the real consumers are registered on
 * the app's in-memory queue, wrapped with runWithTenant exactly as worker.ts
 * does, and the queue is drained after those requests. Only the HRMS HTTP
 * client and the sponsor-config repo (encrypted column) are stubbed. Requires
 * DATABASE_URL pointing at a disposable Postgres migrated through 0053.
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
const REASON = "Monthly salary NEFT batch for SBI";

type Emp = { id: string; employeeNo: string; fullName: string; bankAccountNo: string; bankIfsc: string; netPayMinor: bigint };
const EMPLOYEES: Emp[] = [
  { id: randomUUID(), employeeNo: "DT-EMP-001", fullName: "Asha Rao", bankAccountNo: "123456789012", bankIfsc: "SBIN0001234", netPayMinor: 4523150n },
  { id: randomUUID(), employeeNo: "DT-EMP-002", fullName: "Vikram Singh", bankAccountNo: "998877665544", bankIfsc: "HDFC0000123", netPayMinor: 6100000n },
  { id: randomUUID(), employeeNo: "DT-EMP-003", fullName: "Meera Iyer", bankAccountNo: "555544443333", bankIfsc: "ICIC0000456", netPayMinor: 3999999n },
];
/** Has a master record but only ever appears as an exception (negative-net) slip. */
const EXCEPTION_EMP: Emp = { id: randomUUID(), employeeNo: "DT-EMP-EXC", fullName: "Neg Net", bankAccountNo: "111122223333", bankIfsc: "SBIN0001234", netPayMinor: -250000n };
/** Has a master record and a positive net, but its slip is 'held' (pay withheld). */
const HELD_EMP: Emp = { id: randomUUID(), employeeNo: "DT-EMP-HLD", fullName: "Held Pay", bankAccountNo: "444455556666", bankIfsc: "SBIN0001234", netPayMinor: 1234500n };
const FULL_ACCOUNTS = [...EMPLOYEES, EXCEPTION_EMP, HELD_EMP].map((e) => e.bankAccountNo);
const PAYABLE_TOTAL = EMPLOYEES.reduce((s, e) => s + e.netPayMinor, 0n);

vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({
    employees: [...EMPLOYEES, EXCEPTION_EMP, HELD_EMP].map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, basicMinor: "0",
      payStructureId: null, bankAccountNo: e.bankAccountNo, bankIfsc: e.bankIfsc,
      pan: null, uan: null, cityClass: "X", taxRegime: "new", departmentId: null, pensionScheme: "NPS",
    })),
    lopDays: {},
  })),
  fetchPendingPayrollRuns: vi.fn(async () => 0),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
}));

vi.mock("../src/modules/sponsor-config/repo.js", () => ({
  findByTenantId: vi.fn(async (tenantId: string) => ({
    tenantId, sponsorCode: "SBIN", sponsorIfsc: "SBIN0000001", sponsorAccount: "00000011112222",
    utilityCode: "NACH00000000012", userNumber: "USR001", settlementOffsetDays: 1,
    nachEnabled: true, apbsEnabled: false, maxRecordsPerFile: 100000, maxAmountPerFileMinor: 100000000000n,
  })),
}));

const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerNachReturnConsumers } = await import("../src/modules/nach-return/consumer.js");
const { registerDisbursementTransferConsumers } = await import("../src/modules/disbursement-transfers/consumer.js");

// Mirror worker.ts: every consumer runs inside runWithTenant(msg.tenantId).
{
  type H = (m: { tenantId: string }) => Promise<void>;
  const q = queue as unknown as { subscribe: (topic: string, h: H) => void };
  const raw = q.subscribe.bind(q);
  q.subscribe = (topic: string, h: H) => raw(topic, (m) => runWithTenant(m.tenantId, () => h(m)) as Promise<void>);
}
registerDisbursementTransferConsumers(queue);
registerNachReturnConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

type TxRunner = { execute: (q: unknown) => Promise<unknown> };
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}
function scoped<T>(tenantId: string, fn: (tx: TxRunner) => Promise<T>): Promise<T> {
  return withTenantScope(db as never, tenantId, fn as never) as Promise<T>;
}
function token(roles: string[], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "s1" }, SECRET);
}
const ADMIN = () => token(["payroll_admin"]);

// ux_payroll_runs_tenant_month_ddo_regular: one regular run per tenant+month, so each seed takes its own month.
let monthSeq = 0;
async function seedRun(tenantId: string, opts: { status?: string; withException?: boolean; withHeld?: boolean } = {}): Promise<string> {
  const runId = randomUUID();
  const month = String(2000 + (monthSeq++)) + "-01";
  const slips = [...EMPLOYEES, ...(opts.withException ? [EXCEPTION_EMP] : []), ...(opts.withHeld ? [HELD_EMP] : [])];
  await scoped(tenantId, async (tx) => {
    // run.total_net_minor = net of the PAYABLE slips (what runDisburse reconciles against).
    await tx.execute(sql`
      INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, total_net_minor, created_by, updated_by)
      VALUES (${runId}::uuid, ${tenantId}::uuid, ${"DT/" + runId.slice(0, 8)}, ${month}, ${randomUUID()}::uuid, ${opts.status ?? "approved"},
              ${PAYABLE_TOTAL.toString()}::bigint, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    for (const e of slips) {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, net_pay_minor, status, created_by, updated_by)
        VALUES (${tenantId}::uuid, ${runId}::uuid, ${e.id}::uuid, ${e.employeeNo}, 100::bigint,
                ${e.netPayMinor.toString()}::bigint, ${e === HELD_EMP ? "held" : e.netPayMinor < 0n ? "exception" : "computed"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    }
  });
  return runId;
}

async function setRunStatus(tenantId: string, runId: string, status: string): Promise<void> {
  await scoped(tenantId, (tx) => tx.execute(sql`UPDATE payroll.payroll_runs SET status = ${status} WHERE id = ${runId}::uuid`));
}

async function ledger(tenantId: string, runId: string): Promise<Array<Record<string, unknown>>> {
  return scoped(tenantId, async (tx) => rowsOf(await tx.execute(sql`
    SELECT id, employee_id, employee_no, amount_minor::text AS amount_minor, account_last4, ifsc, status,
           file_format, file_reference, issuance_id, attempt_no, parent_transfer_id, reason_code, reason_text
      FROM payroll.disbursement_transfers WHERE run_id = ${runId}::uuid
     ORDER BY employee_no, attempt_no`)));
}

async function issuances(tenantId: string, runId: string): Promise<Array<Record<string, unknown>>> {
  return scoped(tenantId, async (tx) => rowsOf(await tx.execute(sql`
    SELECT id, seq, mode, file_format, file_name, batch_from, batch_to, line_count, total_minor::text AS total_minor
      FROM payroll.disbursement_file_issuances WHERE run_id = ${runId}::uuid ORDER BY seq`)));
}

async function auditRows(tenantId: string, action: string, resourceId?: string): Promise<Array<Record<string, unknown>>> {
  return scoped(tenantId, async (tx) => rowsOf(await tx.execute(sql`
    SELECT payload FROM _outbox.messages
     WHERE tenant_id = ${tenantId}::uuid AND topic = 'audit.event.record'
       AND payload->>'action' = ${action}
       AND (${resourceId ?? null}::text IS NULL OR payload->>'resourceId' = ${resourceId ?? null}::text)
     ORDER BY created_at`)));
}
const detailOf = (a: Record<string, unknown>) => (a.payload as { detail: Record<string, unknown> }).detail;

async function setStatus(tenantId: string, id: string, status: string, reasonCode: string | null = null): Promise<void> {
  await scoped(tenantId, (tx) => tx.execute(sql`
    UPDATE payroll.disbursement_transfers SET status = ${status}, reason_code = ${reasonCode},
           reason_text = ${reasonCode ? "Account closed" : null} WHERE id = ${id}::uuid`));
}

let app: FastifyInstance;

async function bankFile(runId: string, format: "csv" | "nach", opts: { tenantId?: string; roles?: string[]; extra?: Record<string, unknown> } = {}) {
  return app.inject({
    method: "POST", url: `/v1/payroll/runs/${runId}/bank-file`,
    payload: { format, reason: REASON, ...(opts.extra ?? {}) },
    headers: { authorization: `Bearer ${token(opts.roles ?? ["payroll_admin"], opts.tenantId ?? TENANT)}` },
  });
}

/** Data lines of a CSV bank file (no header, no trailer). */
const csvLines = (body: string) => body.split("\r\n").slice(1, -1);

async function list(query = "", auth = ADMIN()) {
  return app.inject({ method: "GET", url: `/v1/payroll/disbursement/transfers${query}`, headers: { authorization: `Bearer ${auth}` } });
}

async function retry(id: string, reason: string, key: string | null, auth = ADMIN()) {
  const headers: Record<string, string> = { authorization: `Bearer ${auth}` };
  if (key !== null) headers["x-idempotency-key"] = key;
  return app.inject({ method: "POST", url: `/v1/payroll/disbursement/transfers/${id}/retry`, payload: { reason }, headers });
}

async function retryAndDrain(id: string, reason: string, key: string | null, auth = ADMIN()) {
  const res = await retry(id, reason, key, auth);
  await drain();
  return res;
}

async function reconcile(id: string, body: Record<string, unknown>, auth = ADMIN()) {
  const res = await app.inject({ method: "POST", url: `/v1/payroll/disbursement/transfers/${id}/reconcile`, payload: body, headers: { authorization: `Bearer ${auth}` } });
  await drain();
  return res;
}

// ─── NACH return file builder (fixed-width, 160 chars/record) ───────────────
const W = 160;
function returnFile(records: Array<{ reference: string; amountMinor: bigint; statusCode: "0" | "1"; reasonCode?: string }>, headerDate = "04072026"): string {
  const header = ("01" + "10" + "SBIN000000" + "CR" + headerDate + "05072026" + "HDFC0000012345 " + "NACH00000000012   ").padEnd(W, " ");
  const details = records.map((r) => ("02" + "SBIN0001234" + "123456789012345" + "10" + r.amountMinor.toString().padStart(13, "0") +
    "Test Employee".padEnd(40, " ") + r.reference.padEnd(20, " ") + "Salary".padEnd(40, " ") +
    r.statusCode.padEnd(2, " ") + (r.reasonCode ?? "").padEnd(4, " ")).padEnd(W, " "));
  const total = records.reduce((s, r) => s + r.amountMinor, 0n);
  const batch = ("03" + String(records.length).padStart(8, "0") + total.toString().padStart(13, "0") + "0".repeat(13)).padEnd(W, " ");
  const file = ("04" + "0001" + String(records.length).padStart(8, "0") + total.toString().padStart(13, "0")).padEnd(W, " ");
  return [header, ...details, batch, file].join("\r\n") + "\r\n";
}

async function nachReturn(runId: string, content: string, fileReference?: string) {
  const res = await app.inject({
    method: "POST", url: `/v1/payroll/runs/${runId}/nach-return`,
    payload: fileReference ? { content, fileReference } : { content },
    headers: { authorization: `Bearer ${ADMIN()}` },
  });
  await drain();
  return res;
}

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

describe("bank-file issuance -- what a file may carry", () => {
  it("first CSV file: one 'sent' row per payable slip (last-4 only, bigint paise) + issuance + audit in one tx; totals reconcile with run net", async () => {
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId, "csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-bank-file-mode"]).toBe("first");
    expect(csvLines(res.body)).toHaveLength(3);

    const rows = await ledger(TENANT, runId);
    const [iss] = await issuances(TENANT, runId);
    expect(iss).toMatchObject({ seq: 1, mode: "first", file_format: "csv", line_count: 3, total_minor: PAYABLE_TOTAL.toString() });
    expect(res.headers["x-bank-file-issuance-id"]).toBe(iss!.id);
    for (const [i, e] of EMPLOYEES.entries()) {
      expect(rows[i]).toMatchObject({
        employee_id: e.id, amount_minor: e.netPayMinor.toString(), account_last4: e.bankAccountNo.slice(-4),
        ifsc: e.bankIfsc, status: "sent", file_format: "csv", attempt_no: 1, parent_transfer_id: null,
        file_reference: iss!.file_name, issuance_id: iss!.id,
      });
    }
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(FULL_ACCOUNTS.join("|")));

    const audit = await auditRows(TENANT, "bank_file_generated", runId);
    expect(audit).toHaveLength(1);
    expect(detailOf(audit[0]!)).toMatchObject({
      issuanceId: iss!.id, mode: "first", format: "csv", recordCount: 3, reason: REASON, reissue: false,
      totalAmountMinor: PAYABLE_TOTAL.toString(), ledgerRootTotalMinor: PAYABLE_TOTAL.toString(),
      runTotalNetMinor: PAYABLE_TOTAL.toString(), totalsReconcile: true, lineKinds: { first: 3, retry: 0, full_reissue: 0 },
    });
  });

  it("D2: a second file with nothing queued is refused -- 409 REISSUE_WOULD_DUPLICATE_PAYMENT with counts; nothing written", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    const rows = await ledger(TENANT, runId);
    await setStatus(TENANT, rows[0]!.id as string, "success");
    await setRunStatus(TENANT, runId, "disbursed");

    const res = await bankFile(runId, "csv");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("REISSUE_WOULD_DUPLICATE_PAYMENT");
    expect(res.json().message).toMatch(/1 transfer\(s\) already credited \(success\) and 2 already sent/);
    expect(await ledger(TENANT, runId)).toHaveLength(3);
    expect(await issuances(TENANT, runId)).toHaveLength(1);
    expect(await auditRows(TENANT, "bank_file_reissued", runId)).toHaveLength(0);
  });

  it("D2: 409 NOTHING_TO_ISSUE when every transfer failed/returned and none has a queued retry", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    for (const r of await ledger(TENANT, runId)) await setStatus(TENANT, r.id as string, "returned", "01");
    const res = await bankFile(runId, "csv");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOTHING_TO_ISSUE");
  });

  it("D2: a retry re-issue contains EXACTLY the one retried line; untouched rows keep their file and issuance", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    const before = await ledger(TENANT, runId);
    await setStatus(TENANT, before[0]!.id as string, "returned", "01");
    await setStatus(TENANT, before[1]!.id as string, "success");
    const created = await retryAndDrain(before[0]!.id as string, "Bank confirmed the account is updated", randomUUID());
    expect(created.statusCode).toBe(202);
    await setRunStatus(TENANT, runId, "disbursed");

    const res = await bankFile(runId, "csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-bank-file-mode"]).toBe("incremental");
    const lines = csvLines(res.body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("DT-EMP-001");
    expect(res.body).toContain("TRAILER,1,,,45231.50,Control total");

    const after = await ledger(TENANT, runId);
    const iss = await issuances(TENANT, runId);
    expect(iss.map((i) => [i.seq, i.mode, i.line_count])).toEqual([[1, "first", 1 * 3], [2, "incremental", 1]]);
    expect(String(iss[1]!.file_name)).toMatch(/-2\.csv$/);
    const child = after.find((r) => r.id === created.json().data.id)!;
    expect(child).toMatchObject({ status: "sent", attempt_no: 2, file_reference: iss[1]!.file_name, issuance_id: iss[1]!.id });
    // Untouched: the success row and the still-'sent' row keep the FIRST file.
    for (const r of after.filter((x) => x.attempt_no === 1)) {
      expect(r.issuance_id).toBe(iss[0]!.id);
      expect(r.file_reference).toBe(iss[0]!.file_name);
    }
    expect(after.find((r) => r.employee_no === "DT-EMP-003")!.status).toBe("sent");
    const audit = await auditRows(TENANT, "bank_file_reissued", runId);
    expect(audit).toHaveLength(1);
    expect(detailOf(audit[0]!)).toMatchObject({
      mode: "incremental", recordCount: 1, totalAmountMinor: "4523150", lineKinds: { first: 0, retry: 1, full_reissue: 0 },
      notIncluded: { pending: 0, sent: 1, success: 1, failed: 0, returned: 0 },
    });
  });

  it("D2: an explicit full re-issue (payroll_admin + reason) pays everyone again, records a new attempt per line and audits what is paid twice", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    const before = await ledger(TENANT, runId);
    await setStatus(TENANT, before[0]!.id as string, "success");
    await setStatus(TENANT, before[1]!.id as string, "returned", "01");

    const officer = await bankFile(runId, "csv", { roles: ["payroll_officer"], extra: { fullReissue: true, fullReissueReason: "Bank lost the entire batch upload" } });
    expect(officer.statusCode).toBe(403);

    const res = await bankFile(runId, "csv", { extra: { fullReissue: true, fullReissueReason: "Bank lost the entire batch upload" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-bank-file-mode"]).toBe("full_reissue");
    expect(csvLines(res.body)).toHaveLength(3);
    const after = await ledger(TENANT, runId);
    const children = after.filter((r) => r.attempt_no === 2);
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.status === "sent" && before.some((b) => b.id === c.parent_transfer_id))).toBe(true);
    const audit = await auditRows(TENANT, "bank_file_full_reissued", runId);
    expect(audit).toHaveLength(1);
    expect(detailOf(audit[0]!)).toMatchObject({
      mode: "full_reissue", recordCount: 3, fullReissueReason: "Bank lost the entire batch upload",
      paidAgain: { pending: 0, sent: 1, success: 1, failed: 0, returned: 1 }, lineKinds: { first: 0, retry: 0, full_reissue: 3 },
    });
  });

  it("D3: exception slips (negative net) are in neither the file nor the ledger; totals reconcile with run.totalNetMinor", async () => {
    const runId = await seedRun(TENANT, { withException: true });
    const res = await bankFile(runId, "csv");
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("DT-EMP-EXC");
    expect(res.body).not.toContain("-2500");
    expect(csvLines(res.body)).toHaveLength(3);
    const rows = await ledger(TENANT, runId);
    expect(rows.map((r) => r.employee_no)).not.toContain("DT-EMP-EXC");
    expect(detailOf((await auditRows(TENANT, "bank_file_generated", runId))[0]!)).toMatchObject({
      excludedSlips: { exception: 1 }, totalsReconcile: true, runTotalNetMinor: PAYABLE_TOTAL.toString(),
    });
    // A NACH file of the same run would also have rejected a negative line before.
    const runId2 = await seedRun(TENANT, { withException: true });
    const nach = await bankFile(runId2, "nach");
    expect(nach.statusCode).toBe(200);
    expect(await ledger(TENANT, runId2)).toHaveLength(3);
  });

  it("R5: a 'held' slip (positive net, pay withheld) is in neither the file nor the ledger -- payable statuses are an allow-list", async () => {
    const runId = await seedRun(TENANT, { withHeld: true, withException: true });
    const csv = await bankFile(runId, "csv");
    expect(csv.statusCode).toBe(200);
    expect(csv.body).not.toContain("DT-EMP-HLD");
    expect(csvLines(csv.body)).toHaveLength(3);
    expect((await ledger(TENANT, runId)).map((r) => r.employee_no)).not.toContain("DT-EMP-HLD");
    expect(detailOf((await auditRows(TENANT, "bank_file_generated", runId))[0]!)).toMatchObject({
      excludedSlips: { held: 1, exception: 1 }, recordCount: 3, totalsReconcile: true,
    });
    const runId2 = await seedRun(TENANT, { withHeld: true });
    expect((await bankFile(runId2, "nach")).statusCode).toBe(200);
    expect((await ledger(TENANT, runId2)).map((r) => r.employee_no)).not.toContain("DT-EMP-HLD");
  });

  it("R3: while another issuance of the run holds the lock, a request gets 409 ISSUANCE_IN_PROGRESS instead of waiting", async () => {
    const runId = await seedRun(TENANT);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`disbursement-bank-file:${TENANT}:${runId}`}, 0))`);
      const res = await bankFile(runId, "csv");
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("ISSUANCE_IN_PROGRESS");
    }));
    expect(await issuances(TENANT, runId)).toHaveLength(0);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
  });

  it("refuses (409 LEDGER_MISMATCH) when the ledger no longer matches the run's payable slips", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    const rows = await ledger(TENANT, runId);
    await scoped(TENANT, (tx) => tx.execute(sql`UPDATE payroll.disbursement_transfers SET amount_minor = amount_minor + 1 WHERE id = ${rows[0]!.id as string}::uuid`));
    const res = await bankFile(runId, "csv", { extra: { fullReissue: true, fullReissueReason: "Investigating a reported shortfall" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LEDGER_MISMATCH");
    expect(await issuances(TENANT, runId)).toHaveLength(1);
  });

  it("a refused generation (bad bank details) writes no issuance, ledger rows or audit", async () => {
    const runId = await seedRun(TENANT);
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchPayrollInput).mockResolvedValueOnce({ employees: [], lopDays: {} } as never);
    const res = await bankFile(runId, "csv");
    expect(res.statusCode).toBe(422);
    expect(await ledger(TENANT, runId)).toHaveLength(0);
    expect(await issuances(TENANT, runId)).toHaveLength(0);
    expect(await auditRows(TENANT, "bank_file_generated", runId)).toHaveLength(0);
  });

  it("D5: concurrent clicks -- exactly one file is issued, the other is refused; no file exists without its ledger", async () => {
    const runId = await seedRun(TENANT);
    const results = await Promise.all([bankFile(runId, "csv"), bankFile(runId, "csv"), bankFile(runId, "csv")]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.statusCode !== 200)) {
      expect(r.statusCode).toBe(409);
      expect(["ISSUANCE_IN_PROGRESS", "REISSUE_WOULD_DUPLICATE_PAYMENT"]).toContain(r.json().code);
    }
    expect(await ledger(TENANT, runId)).toHaveLength(3);
    expect(await issuances(TENANT, runId)).toHaveLength(1);
  });
});

describe("NACH files and return ingestion", () => {
  it("settles success/returned for the named file, rejects a duplicate upload, and needs the file name once a run has two NACH files", async () => {
    const runId = await seedRun(TENANT);
    const first = await bankFile(runId, "nach");
    expect(first.statusCode).toBe(200);
    const [iss1] = await issuances(TENANT, runId);
    expect(String(iss1!.file_name)).toMatch(/^NACH_SBIN_1_\d{8}\.txt$/);
    expect(iss1).toMatchObject({ batch_from: 1, batch_to: 1 });

    const ret = returnFile([
      { reference: "DT-EMP-001", amountMinor: EMPLOYEES[0]!.netPayMinor, statusCode: "0" },
      { reference: "DT-EMP-002", amountMinor: EMPLOYEES[1]!.netPayMinor, statusCode: "1", reasonCode: "01" },
      { reference: "DT-EMP-003", amountMinor: 1n, statusCode: "1", reasonCode: "05" }, // wrong amount: unmatched
    ]);
    const up = await nachReturn(runId, ret); // single NACH file -> inferred
    expect(up.statusCode).toBe(202);
    expect(up.json().data.fileReference).toBe(iss1!.file_name);
    let rows = await ledger(TENANT, runId);
    expect(rows.map((r) => [r.employee_no, r.status, r.reason_code])).toEqual([
      ["DT-EMP-001", "success", null], ["DT-EMP-002", "returned", "01"], ["DT-EMP-003", "sent", null],
    ]);
    const processed = await auditRows(TENANT, "nach_return_processed", runId);
    expect(detailOf(processed[0]!).ledger).toMatchObject({ matched: 2, unmatched: 1, success: 1, returned: 1, reversals: 0 });

    // Same content again (even with different line-end whitespace): 409, nothing re-applied.
    const dup = await nachReturn(runId, ret.replace(/\r\n/g, "\n"));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_RETURN_FILE");

    // Retry the returned one -> a second NACH file carrying only that line.
    const r = await retryAndDrain(rows[1]!.id as string, "Account corrected by the employee", randomUUID());
    expect(r.statusCode).toBe(202);
    const second = await bankFile(runId, "nach");
    expect(second.statusCode).toBe(200);
    const iss = await issuances(TENANT, runId);
    expect(iss[1]).toMatchObject({ mode: "incremental", line_count: 1, batch_from: 2 });
    expect(String(iss[1]!.file_name)).toMatch(/^NACH_SBIN_2_\d{8}\.txt$/);

    // Two NACH files now: the return must say which one it answers.
    const ambiguous = await nachReturn(runId, returnFile([{ reference: "DT-EMP-002", amountMinor: EMPLOYEES[1]!.netPayMinor, statusCode: "0" }], "05072026"));
    expect(ambiguous.statusCode).toBe(422);
    expect(ambiguous.json().code).toBe("FILE_REFERENCE_REQUIRED");
    const unknown = await nachReturn(runId, returnFile([{ reference: "DT-EMP-002", amountMinor: 1n, statusCode: "0" }], "06072026"), "NACH_NOPE.txt");
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().code).toBe("UNKNOWN_FILE_REFERENCE");
  });

  it("D4: a stale return for the FIRST file cannot fail the retry that is in flight in the second file", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "nach")).statusCode).toBe(200);
    const [iss1] = await issuances(TENANT, runId);
    const original = returnFile([{ reference: "DT-EMP-002", amountMinor: EMPLOYEES[1]!.netPayMinor, statusCode: "1", reasonCode: "01" }]);
    expect((await nachReturn(runId, original)).statusCode).toBe(202);
    const root = (await ledger(TENANT, runId)).find((x) => x.employee_no === "DT-EMP-002")!;
    expect(root.status).toBe("returned");
    expect((await retryAndDrain(root.id as string, "Account corrected by the employee", randomUUID())).statusCode).toBe(202);
    expect((await bankFile(runId, "nach")).statusCode).toBe(200);

    // A re-sent copy of the ORIGINAL return (different header -> different hash), naming file 1.
    const stale = returnFile([{ reference: "DT-EMP-002", amountMinor: EMPLOYEES[1]!.netPayMinor, statusCode: "1", reasonCode: "01" }], "09072026");
    expect((await nachReturn(runId, stale, iss1!.file_name as string)).statusCode).toBe(202);
    const retryRow = (await ledger(TENANT, runId)).find((x) => x.employee_no === "DT-EMP-002" && x.attempt_no === 2)!;
    expect(retryRow.status).toBe("sent");
  });

  it("R1: after a full re-issue, file 1's credit still settles its (superseded) row and flags a possible double payment", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "nach")).statusCode).toBe(200);
    const full = await bankFile(runId, "nach", { extra: { fullReissue: true, fullReissueReason: "Sponsor bank lost the upload" } });
    expect(full.statusCode).toBe(200);
    const [iss1, iss2] = await issuances(TENANT, runId);
    expect(iss2).toMatchObject({ mode: "full_reissue", batch_from: 2 });

    const ret = returnFile([{ reference: "DT-EMP-001", amountMinor: EMPLOYEES[0]!.netPayMinor, statusCode: "0" }]);
    expect((await nachReturn(runId, ret, iss1!.file_name as string)).statusCode).toBe(202);
    const rows = (await ledger(TENANT, runId)).filter((x) => x.employee_no === "DT-EMP-001");
    const root = rows.find((x) => x.attempt_no === 1)!;
    const child = rows.find((x) => x.attempt_no === 2)!;
    expect(root.status).toBe("success");
    expect(child.status).toBe("sent");
    const dup = await auditRows(TENANT, "disbursement_transfer_duplicate_credit_detected", root.id as string);
    expect(dup).toHaveLength(1);
    expect(detailOf(dup[0]!)).toMatchObject({
      transferId: root.id, childTransferId: child.id, fileReference: iss1!.file_name,
      amountMinor: EMPLOYEES[0]!.netPayMinor.toString(), requiresReview: true,
    });
  });

  it("D4: success -> returned is applied but audited with fromStatus and requiresReview", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "nach")).statusCode).toBe(200);
    const credited = returnFile([{ reference: "DT-EMP-003", amountMinor: EMPLOYEES[2]!.netPayMinor, statusCode: "0" }]);
    expect((await nachReturn(runId, credited)).statusCode).toBe(202);
    const late = returnFile([{ reference: "DT-EMP-003", amountMinor: EMPLOYEES[2]!.netPayMinor, statusCode: "1", reasonCode: "06" }], "08072026");
    expect((await nachReturn(runId, late)).statusCode).toBe(202);
    const row = (await ledger(TENANT, runId)).find((x) => x.employee_no === "DT-EMP-003")!;
    expect(row).toMatchObject({ status: "returned", reason_code: "06" });
    const rev = await auditRows(TENANT, "disbursement_transfer_settlement_reversed", row.id as string);
    expect(rev).toHaveLength(1);
    expect(detailOf(rev[0]!)).toMatchObject({ fromStatus: "success", toStatus: "returned", requiresReview: true, reasonCode: "06" });
  });
});

describe("GET /v1/payroll/disbursement/transfers", () => {
  let runId: string;
  let otherRunId: string;
  beforeAll(async () => {
    runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    otherRunId = await seedRun(OTHER_TENANT);
    expect((await bankFile(otherRunId, "csv", { tenantId: OTHER_TENANT })).statusCode).toBe(200);
  });

  it("returns the web's row shape with the account masked server-side -- no full account number in the body", async () => {
    const res = await list(`?runId=${runId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(new RegExp(FULL_ACCOUNTS.join("|")));
    const body = res.json() as { data: Array<Record<string, unknown>>; meta: Record<string, number> };
    expect(body.meta).toEqual({ limit: 100, offset: 0, total: 3 });
    const asha = body.data.find((r) => r.employeeNo === "DT-EMP-001")!;
    expect(asha).toMatchObject({
      runId, employeeName: "Asha Rao", accountNumberMasked: "XXXX9012", ifsc: "SBIN0001234",
      amountPaise: "4523150", amountRupees: 45231.5, status: "sent", fileFormat: "csv",
      nachBatchId: null, failureReason: null, attemptNo: 1, parentTransferId: null,
    });
    expect(asha).not.toHaveProperty("accountNumber");
  });

  it("is tenant-scoped: another tenant's rows never appear, even when asked for by runId", async () => {
    const res = await list(`?runId=${otherRunId}`);
    expect(res.json().data).toEqual([]);
    const mine = (await list("?limit=500")).json().data as Array<{ runId: string }>;
    expect(mine.some((r) => r.runId === otherRunId)).toBe(false);
  });

  it("filters by status and paginates", async () => {
    const rows = await ledger(TENANT, runId);
    await setStatus(TENANT, rows[1]!.id as string, "failed", "01");
    const failed = (await list(`?runId=${runId}&status=failed`)).json();
    expect(failed.data).toHaveLength(1);
    expect(failed.data[0]).toMatchObject({ status: "failed", failureReason: "Account closed", reasonCode: "01" });
    const page = (await list(`?runId=${runId}&limit=2&offset=2`)).json();
    expect(page.data).toHaveLength(1);
    expect(page.meta).toEqual({ limit: 2, offset: 2, total: 3 });
    expect((await list("?status=bogus")).statusCode).toBe(400);
  });

  it.each([["employee"], ["hr_admin"], ["manager"]])("role %s gets 403 (matches the page gate)", async (role) => {
    expect((await list("", token([role]))).statusCode).toBe(403);
  });

  it("payroll_officer may read", async () => {
    expect((await list("", token(["payroll_officer"]))).statusCode).toBe(200);
  });
});

describe("POST /v1/payroll/disbursement/transfers/:id/retry", () => {
  async function failedRow(status: "failed" | "returned" = "returned"): Promise<{ runId: string; id: string }> {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    const rows = await ledger(TENANT, runId);
    await setStatus(TENANT, rows[0]!.id as string, status, "01");
    return { runId, id: rows[0]!.id as string };
  }

  it.each([["sent"], ["success"], ["pending"]])("409 INVALID_STATE for a %s transfer", async (status) => {
    const { id } = await failedRow();
    await setStatus(TENANT, id, status);
    const res = await retry(id, "Bank confirmed the account is updated", randomUUID());
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("400 for a reason under 10 chars and for a missing idempotency key; 404 for an unknown id", async () => {
    const { id } = await failedRow();
    expect((await retry(id, "too short", randomUUID())).statusCode).toBe(400);
    const noKey = await retry(id, "Bank confirmed the account is updated", null);
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect((await retry(randomUUID(), "Bank confirmed the account is updated", randomUUID())).statusCode).toBe(404);
  });

  it("creates ONE pending attempt linked to its parent, audited; same key replays it; reused key with another payload is 409", async () => {
    const { runId, id } = await failedRow("failed");
    const key = randomUUID();
    const first = await retryAndDrain(id, "Bank confirmed the account is updated", key);
    expect(first.statusCode).toBe(202);
    expect(first.json().data).toMatchObject({ status: "pending", parentTransferId: id });
    const childId = first.json().data.id as string;

    const replay = await retry(id, "Bank confirmed the account is updated", key);
    expect(replay.statusCode).toBe(200);
    const child = replay.json().data;
    expect(child).toMatchObject({ id: childId, status: "pending", attemptNo: 2, parentTransferId: id, runId, amountPaise: "4523150" });

    const reused = await retryAndDrain(id, "A different reason for the same key", key);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe("IDEMPOTENCY_KEY_REUSED");

    const second = await retryAndDrain(id, "Bank confirmed the account is updated", randomUUID());
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("ALREADY_RETRIED");

    const rows = await ledger(TENANT, runId);
    expect(rows.filter((r) => r.parent_transfer_id === id)).toHaveLength(1);

    const audit = await auditRows(TENANT, "disbursement_transfer_retry_requested", child.id);
    expect(audit).toHaveLength(1);
    expect((audit[0]!.payload as { outcome: string }).outcome).toBe("success");
    expect((audit[0]!.payload as { detail: Record<string, unknown> }).detail).toMatchObject({
      parentTransferId: id, parentStatus: "failed", attemptNo: 2, amountMinor: "4523150",
      reason: "Bank confirmed the account is updated", idempotencyKey: key, makerChecker: false,
    });

    // Default list shows the current attempt only (the child), not the superseded parent.
    const listed = (await list(`?runId=${runId}`)).json().data as Array<{ id: string }>;
    expect(listed.map((r) => r.id)).toContain(child.id);
    expect(listed.map((r) => r.id)).not.toContain(id);
    const all = (await list(`?runId=${runId}&includeSuperseded=true`)).json().data as Array<{ id: string }>;
    expect(all.map((r) => r.id)).toContain(id);
  });

  it("race: concurrent retries with different keys produce exactly one attempt; the losers are audited as rejected", async () => {
    const { runId, id } = await failedRow();
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      retry(id, "Double-click on the retry confirmation", randomUUID())));
    await drain();
    const accepted = results.filter((r) => r.statusCode === 202).length;
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.statusCode === 202 || r.statusCode === 409)).toBe(true);
    expect((await ledger(TENANT, runId)).filter((r) => r.parent_transfer_id === id)).toHaveLength(1);
    const rejected = (await auditRows(TENANT, "disbursement_transfer_retry_requested", id))
      .filter((a) => (a.payload as { outcome: string }).outcome === "failure");
    expect(rejected).toHaveLength(accepted - 1);
    for (const r of rejected) expect((r.payload as { detail: { code: string } }).detail.code).toBe("ALREADY_RETRIED");
  });

  it("race: concurrent retries with the SAME key all resolve to the same attempt", async () => {
    const { runId, id } = await failedRow();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      retry(id, "Network retry of the same confirmation", key)));
    await drain();
    expect(results.every((r) => r.statusCode === 202 || r.statusCode === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json().data.id)).size).toBe(1);
    const children = (await ledger(TENANT, runId)).filter((r) => r.parent_transfer_id === id);
    expect(children).toHaveLength(1);
    expect(children[0]!.id).toBe(results[0]!.json().data.id);
  });

  it("race: the same key with a DIFFERENT payload in flight creates one attempt and audits the reuse", async () => {
    const { runId, id } = await failedRow();
    const key = randomUUID();
    const results = await Promise.all([
      retry(id, "First reason for this retry", key),
      retry(id, "Second, different reason", key),
    ]);
    await drain();
    expect((await ledger(TENANT, runId)).filter((r) => r.parent_transfer_id === id)).toHaveLength(1);
    const reuse = (await auditRows(TENANT, "disbursement_transfer_retry_requested", id))
      .filter((a) => (a.payload as { detail: { code?: string } }).detail.code === "IDEMPOTENCY_KEY_REUSED");
    const accepted = results.filter((r) => r.statusCode === 202).length;
    expect(reuse).toHaveLength(accepted - 1);
    expect(results.every((r) => r.statusCode === 202 || r.statusCode === 409)).toBe(true);
  });

  it("409 RUN_NOT_PAYABLE when the run can no longer carry a bank file", async () => {
    const { runId, id } = await failedRow();
    await setRunStatus(TENANT, runId, "cancelled");
    const res = await retry(id, "Bank confirmed the account is updated", randomUUID());
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("RUN_NOT_PAYABLE");
  });

  it("tenant isolation: another tenant cannot retry this tenant's transfer (404)", async () => {
    const { id } = await failedRow();
    const res = await retry(id, "Bank confirmed the account is updated", randomUUID(), token(["payroll_admin"], OTHER_TENANT));
    expect(res.statusCode).toBe(404);
  });

  it("403 for a role outside the payroll gate", async () => {
    const { id } = await failedRow();
    expect((await retry(id, "Bank confirmed the account is updated", randomUUID(), token(["hr_admin"]))).statusCode).toBe(403);
  });
});

describe("POST /v1/payroll/disbursement/transfers/:id/reconcile (manual, non-NACH)", () => {
  it("payroll_admin marks a sent CSV row success/failed with an audited reason; a second reconcile is 409", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "csv")).statusCode).toBe(200);
    const rows = await ledger(TENANT, runId);

    const ok = await reconcile(rows[0]!.id as string, { outcome: "success", reason: "SBI statement 2026-09-30 shows credit" });
    expect(ok.statusCode).toBe(202);
    const bad = await reconcile(rows[1]!.id as string, { outcome: "failed", reasonCode: "R03", reason: "Bank rejection advice: account frozen" });
    expect(bad.statusCode).toBe(202);

    const listed = (await list(`?runId=${runId}`)).json().data as Array<Record<string, unknown>>;
    expect(listed.find((r) => r.id === rows[0]!.id)).toMatchObject({ status: "success", failureReason: null });
    expect(listed.find((r) => r.id === rows[1]!.id)).toMatchObject({ status: "failed", reasonCode: "R03", failureReason: "Bank rejection advice: account frozen" });

    const again = await reconcile(rows[0]!.id as string, { outcome: "failed", reason: "Changed my mind about this" });
    expect(again.statusCode).toBe(409);

    const audit = await auditRows(TENANT, "disbursement_transfer_reconciled", rows[0]!.id as string);
    expect(audit).toHaveLength(1);
    expect((audit[0]!.payload as { detail: Record<string, unknown> }).detail).toMatchObject({
      fromStatus: "sent", toStatus: "success", manual: true, reason: "SBI statement 2026-09-30 shows credit",
    });
  });

  it("payroll_officer gets 403; short reason 400; NACH rows 409 (settled by return file)", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId, "nach")).statusCode).toBe(200);
    const rows = await ledger(TENANT, runId);
    const id = rows[0]!.id as string;
    expect((await reconcile(id, { outcome: "success", reason: "SBI statement shows credit" }, token(["payroll_officer"]))).statusCode).toBe(403);
    expect((await reconcile(id, { outcome: "success", reason: "short" })).statusCode).toBe(400);
    const nach = await reconcile(id, { outcome: "success", reason: "SBI statement shows credit" });
    expect(nach.statusCode).toBe(409);
    expect(nach.json().code).toBe("NACH_USES_RETURN_FILE");
  });
});
