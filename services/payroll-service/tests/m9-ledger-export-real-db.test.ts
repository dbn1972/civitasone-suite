/**
 * M9 (payroll without Finance) over the real routes, consumers and Postgres (RLS).
 *
 *   export tenant (no Finance module): approve / disburse store the journal
 *     instead of sending payroll.run.approved / .disbursed / the EFT instruction;
 *     maker-checker and the audit trail still apply; slips are marked paid from
 *     the bank confirmation file, a NACH return or a manual reconcile.
 *   finance tenant (every current tenant): the run emits exactly the events it
 *     always did, stores no journal, refuses the new endpoints, and its slips
 *     are marked paid only by finance.payment.made.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/payroll/repo.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { registerNachReturnConsumers } from "../src/modules/nach-return/consumer.js";
import { registerLedgerExportConsumers } from "../src/modules/ledger-export/consumer.js";
import { registerDisbursementTransferConsumers } from "../src/modules/disbursement-transfers/consumer.js";
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { setModuleKeyFetcher } from "../src/shared/tenant-modules.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollReadiness: async () => new Map<string, string[]>(), fetchEmployeeSummaries: async () => new Map() };
});

const memQueue = queue as unknown as MemoryQueue;
const SECRET = process.env.JWT_SECRET ?? "";
const EFT = "finance.payment.eft.initiate";

type Evt = { topic: string; actorId: string; payload: Record<string, unknown> };
/** The events a transaction enqueued: read from the outbox rows (the relay is not running in this suite). */
async function eventsOf(tenantId: string, topic: string): Promise<Evt[]> {
  const rows = await runWithTenant(tenantId, () => db.transaction(async (tx) =>
    Array.from((await tx.execute(sql`SELECT topic, actor_id::text AS actor_id, payload FROM _outbox.messages WHERE tenant_id = ${tenantId}::uuid AND topic = ${topic} ORDER BY created_at, id`)) as unknown as Iterable<{ topic: string; actor_id: string; payload: Record<string, unknown> }>)));
  return rows.map((r) => ({ topic: r.topic, actorId: r.actor_id, payload: r.payload }));
}
const auditsOf = async (tenantId: string, action: string): Promise<Evt[]> => (await eventsOf(tenantId, "audit.event.record")).filter((e) => e.payload.action === action);

const MAKER = randomUUID();
const CHECKER = randomUUID();
const DISBURSER = randomUUID();

const gross = 5_000_000n; // Rs 50,000.00
const net = 4_200_000n; // Rs 42,000.00

type World = { tenantId: string; runId: string; slipOk: string; slipOk2: string; slipNeg: string; empOk: string; empOk2: string; empNeg: string };

const bearer = (tenantId: string, sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: tenantId, roles, sid: randomUUID() }, SECRET)}`, "content-type": "application/json",
});

const hasFinance = new Map<string, boolean>();
let app: Awaited<ReturnType<typeof buildApp>>;

async function seedRun(tenantId: string, withFinance: boolean, status = "computed"): Promise<World> {
  hasFinance.set(tenantId, withFinance);
  const w: World = { tenantId, runId: randomUUID(), slipOk: randomUUID(), slipOk2: randomUUID(), slipNeg: randomUUID(), empOk: randomUUID(), empOk2: randomUUID(), empNeg: randomUUID() };
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await repo.insertRun(tx, {
      id: w.runId, tenantId, runNo: `M9-${w.runId.slice(0, 6)}`, month: "2026-09", departmentId: null, structureId: randomUUID(),
      runType: "regular", ddoCode: null, totalGrossMinor: status === "disbursed" ? gross * 2n : 0n, totalNetMinor: status === "disbursed" ? net * 2n : 0n, currency: "INR", status, createdBy: MAKER, updatedBy: MAKER,
    });
    const base = { tenantId, runId: w.runId, basicMinor: 3_000_000n, currency: "INR", components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 3000000 }], createdBy: MAKER, updatedBy: MAKER };
    await repo.insertSlip(tx, { ...base, id: w.slipOk, employeeId: w.empOk, employeeNo: "EMP-M9-1", grossMinor: gross, totalDeductionsMinor: gross - net, netPayMinor: net, status: "computed" });
    await repo.insertSlip(tx, { ...base, id: w.slipOk2, employeeId: w.empOk2, employeeNo: "EMP-M9-2", grossMinor: gross, totalDeductionsMinor: gross - net, netPayMinor: net, status: "computed" });
  }));
  return w;
}

async function approveAndDisburse(w: World): Promise<void> {
  const a = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${w.runId}/approve`, headers: bearer(w.tenantId, CHECKER, ["super_admin"]), payload: { reason: "Reviewed the register" } });
  expect(a.statusCode).toBe(202);
  await memQueue.drain();
  const d = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${w.runId}/disburse`, headers: bearer(w.tenantId, DISBURSER, ["payroll_admin"]), payload: { reason: "Bank file checked" } });
  expect(d.statusCode).toBe(202);
  await memQueue.drain();
}

const slipStatus = (w: World, id: string) => runWithTenant(w.tenantId, () => db.transaction(async (tx) => {
  const r = (await tx.execute(sql`SELECT status FROM payroll.payroll_slips WHERE id = ${id}::uuid`)) as unknown as Array<{ status: string }>;
  return r[0]?.status;
}));
const journalRows = (w: World) => runWithTenant(w.tenantId, () => db.transaction(async (tx) =>
  Array.from((await tx.execute(sql`SELECT stage, voucher_no, posting_date::text AS posting_date, lines FROM payroll.payroll_journal_exports WHERE run_id = ${w.runId}::uuid ORDER BY stage`)) as unknown as Iterable<{ stage: string; voucher_no: string; posting_date: string; lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }> }>)));

beforeAll(async () => {
  setModuleKeyFetcher(async (tid) => (hasFinance.get(tid) === false ? ["hrms", "payroll"] : ["hrms", "payroll", "finance"]));
  registerPayrollConsumers(queue);
  registerNachReturnConsumers(queue);
  registerLedgerExportConsumers(queue);
  registerDisbursementTransferConsumers(queue);
  registerIntegrationConsumers(queue);
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  setModuleKeyFetcher();
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

afterEach(() => { vi.restoreAllMocks(); });

describe("export-only ledger mode (tenant without Finance)", () => {
  let w: World;
  beforeAll(async () => { w = await seedRun(randomUUID(), false); });

  it("the mode is derived from the module list and reported with its source", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ledger-mode", headers: bearer(w.tenantId, CHECKER, ["payroll_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: "export", source: "derived", override: null, hasFinance: false });
  });

  it("maker-checker still applies: the creator cannot approve (403) and nothing is stored", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${w.runId}/approve`, headers: bearer(w.tenantId, MAKER, ["super_admin"]), payload: { reason: "approving my own run" } });
    await memQueue.drain();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect(await journalRows(w)).toEqual([]);
  });

  it("approval stores the accrual journal and sends NOTHING to finance", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${w.runId}/approve`, headers: bearer(w.tenantId, CHECKER, ["super_admin"]), payload: { reason: "Reviewed the register" } });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    expect(await eventsOf(w.tenantId, "payroll.run.approved")).toEqual([]);
    const rows = await journalRows(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: "accrual", voucher_no: `PAY/2026-09/${w.runId.slice(0, 8)}`, posting_date: "2026-09-30" });
    const debit = rows[0]!.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const credit = rows[0]!.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(debit).toBe(credit);
    expect(rows[0]!.lines[0]).toEqual({ accountCode: "5001", debitMinor: (gross * 2n).toString(), creditMinor: "0", narration: "Salary expense" });
    expect(rows[0]!.lines[1]).toMatchObject({ accountCode: "2101", creditMinor: (net * 2n).toString() });
  });

  it("the approval is audited, and so is the journal that was produced", async () => {
    expect(await auditsOf(w.tenantId, "approve")).toHaveLength(1);
    const j = await auditsOf(w.tenantId, "journal_exported");
    expect(j).toHaveLength(1);
    expect(j[0]!.payload).toMatchObject({ resourceId: w.runId, stage: "accrual", voucherNo: `PAY/2026-09/${w.runId.slice(0, 8)}` });
  });

  it("disbursement by the approver is refused; by another person it stores the settlement journal and sends no EFT instruction", async () => {
    const denied = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${w.runId}/disburse`, headers: bearer(w.tenantId, CHECKER, ["payroll_admin"]), payload: { reason: "disbursing what I approved" } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("MAKER_CHECKER_VIOLATION");
    const ok = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${w.runId}/disburse`, headers: bearer(w.tenantId, DISBURSER, ["payroll_admin"]), payload: { reason: "Bank file checked" } });
    await memQueue.drain();
    expect(ok.statusCode).toBe(202);
    expect(await eventsOf(w.tenantId, "payroll.run.disbursed")).toEqual([]);
    expect(await eventsOf(w.tenantId, EFT)).toEqual([]);
    const rows = await journalRows(w);
    expect(rows.map((r) => r.stage)).toEqual(["accrual", "disbursement"]);
    expect(rows[1]).toMatchObject({ voucher_no: `PAYSTL/2026-09/${w.runId.slice(0, 8).toUpperCase()}` });
    expect(rows[1]!.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([["2101", (net * 2n).toString(), "0"], ["1101", "0", (net * 2n).toString()]]);
    expect((await auditsOf(w.tenantId, "journal_exported")).map((a) => a.payload.stage)).toEqual(["accrual", "disbursement"]);
    expect(await auditsOf(w.tenantId, "disburse")).toHaveLength(1);
  });

  it("slips are NOT paid yet: no finance.payment.made will come, so they wait for the bank", async () => {
    expect(await slipStatus(w, w.slipOk)).not.toBe("paid");
    expect(await slipStatus(w, w.slipOk2)).not.toBe("paid");
  });

  it("downloads the journals as CSV and as Tally XML; a stage filter narrows them; an unknown run is 404", async () => {
    const csv = await app.inject({ method: "GET", url: `/v1/payroll/runs/${w.runId}/journal-export`, headers: bearer(w.tenantId, MAKER, ["payroll_officer"]) });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(`payroll-journal-2026-09-${w.runId.slice(0, 8)}.csv`);
    expect(csv.body).toContain("PAY/2026-09/");
    expect(csv.body).toContain("PAYSTL/2026-09/");
    expect(csv.body).toContain("100000.00"); // gross of both slips, from paise
    const tally = await app.inject({ method: "GET", url: `/v1/payroll/runs/${w.runId}/journal-export?format=tally&stage=disbursement`, headers: bearer(w.tenantId, MAKER, ["payroll_admin"]) });
    expect(tally.statusCode).toBe(200);
    expect(tally.headers["content-type"]).toContain("application/xml");
    expect(tally.body).toContain("<VOUCHERNUMBER>PAYSTL/");
    expect(tally.body).not.toContain("<VOUCHERNUMBER>PAY/");
    const missing = await app.inject({ method: "GET", url: `/v1/payroll/runs/${randomUUID()}/journal-export`, headers: bearer(w.tenantId, MAKER, ["payroll_admin"]) });
    expect(missing.statusCode).toBe(404);
    const denied = await app.inject({ method: "GET", url: `/v1/payroll/runs/${w.runId}/journal-export`, headers: bearer(w.tenantId, MAKER, ["employee"]) });
    expect(denied.statusCode).toBe(403);
  });

  it("another tenant cannot read this run's journal", async () => {
    const other = await seedRun(randomUUID(), false);
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${w.runId}/journal-export`, headers: bearer(other.tenantId, MAKER, ["payroll_admin"]) });
    expect(res.statusCode).toBe(404);
  });

  it("a bank confirmation file marks exactly the confirmed slips paid; a wrong amount, an unknown employee and a failure do not", async () => {
    const file = [
      "employee_no,amount,utr,status",
      "EMP-M9-1,42000.00,UTR0001,SUCCESS",
      "EMP-M9-2,41999.00,UTR0002,SUCCESS", // amount differs from the slip
      "EMP-GHOST,10.00,UTR0003,SUCCESS",
    ].join("\n");
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${w.runId}/bank-confirmation`, headers: { ...bearer(w.tenantId, DISBURSER, ["payroll_admin"]), "content-type": "text/csv" }, payload: file });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ rows: 3, success: 3, failed: 0 });
    expect(await slipStatus(w, w.slipOk)).toBe("paid");
    expect(await slipStatus(w, w.slipOk2)).not.toBe("paid");
    const a = await auditsOf(w.tenantId, "bank_confirmation_processed");
    expect(a).toHaveLength(1);
    expect(a[0]!.actorId).toBe(DISBURSER);
    expect(a[0]!.payload).toMatchObject({
      resourceId: w.runId, slipsMarkedPaid: 1, unknownEmployeeNos: ["EMP-GHOST"], requiresReview: true,
      amountMismatch: [{ employeeNo: "EMP-M9-2", fileMinor: "4199900", slipMinor: net.toString() }],
    });
  });

  it("the same file again changes nothing and adds no second audit row; the corrected file pays the rest", async () => {
    const file = "employee_no,amount,utr,status\nEMP-M9-1,42000.00,UTR0001,SUCCESS\nEMP-M9-2,41999.00,UTR0002,SUCCESS\nEMP-GHOST,10.00,UTR0003,SUCCESS";
    await app.inject({ method: "POST", url: `/v1/payroll/runs/${w.runId}/bank-confirmation`, headers: { ...bearer(w.tenantId, DISBURSER, ["payroll_admin"]), "content-type": "text/csv" }, payload: file });
    await memQueue.drain();
    expect(await auditsOf(w.tenantId, "bank_confirmation_processed")).toHaveLength(1);
    const fixed = await app.inject({ method: "POST", url: `/v1/payroll/runs/${w.runId}/bank-confirmation`, headers: bearer(w.tenantId, DISBURSER, ["payroll_admin"]), payload: { content: "EMP-M9-2,42000,UTR0002" } });
    await memQueue.drain();
    expect(fixed.statusCode).toBe(202);
    expect(await slipStatus(w, w.slipOk2)).toBe("paid");
    expect(await auditsOf(w.tenantId, "bank_confirmation_processed")).toHaveLength(2);
  });

  it("only payroll admins may upload a confirmation; a bad file is a 400 and nothing is queued", async () => {
    const officer = await app.inject({ method: "POST", url: `/v1/payroll/runs/${w.runId}/bank-confirmation`, headers: { ...bearer(w.tenantId, MAKER, ["payroll_officer"]), "content-type": "text/csv" }, payload: "EMP-M9-1" });
    expect(officer.statusCode).toBe(403);
    const bad = await app.inject({ method: "POST", url: `/v1/payroll/runs/${w.runId}/bank-confirmation`, headers: { ...bearer(w.tenantId, MAKER, ["payroll_admin"]), "content-type": "text/csv" }, payload: "employee_no,amount\nEMP-M9-1,abc" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("INVALID_BANK_FILE");
  });

  it("a run that is not disbursed cannot be confirmed (409)", async () => {
    const early = await seedRun(randomUUID(), false);
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${early.runId}/bank-confirmation`, headers: { ...bearer(early.tenantId, MAKER, ["payroll_admin"]), "content-type": "text/csv" }, payload: "EMP-M9-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("RUN_NOT_DISBURSED");
  });

  it("a negative-net exception slip is never paid by a confirmation", async () => {
    const x = await seedRun(randomUUID(), false, "disbursed");
    await runWithTenant(x.tenantId, () => db.transaction(async (tx) => {
      await repo.insertSlip(tx, {
        id: x.slipNeg, tenantId: x.tenantId, runId: x.runId, employeeId: x.empNeg, employeeNo: "EMP-M9-NEG", basicMinor: 3_000_000n, grossMinor: gross,
        totalDeductionsMinor: gross + 500_000n, netPayMinor: -500_000n, currency: "INR", components: [], status: "exception", createdBy: MAKER, updatedBy: MAKER,
      });
    }));
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${x.runId}/bank-confirmation`, headers: { ...bearer(x.tenantId, DISBURSER, ["payroll_admin"]), "content-type": "text/csv" }, payload: "EMP-M9-1\nEMP-M9-NEG\n" });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    expect(await slipStatus(x, x.slipOk)).toBe("paid");
    expect(await slipStatus(x, x.slipNeg)).toBe("exception");
    expect((await auditsOf(x.tenantId, "bank_confirmation_processed"))[0]!.payload).toMatchObject({ notPayableEmployeeNos: ["EMP-M9-NEG"] });
  });
});

describe("export mode: NACH return and manual reconcile mark slips paid", () => {
  it("a credited NACH line marks its slip paid; a returned line does not", async () => {
    const w = await seedRun(randomUUID(), false);
    await approveAndDisburse(w);
    const fileRef = "NACH_TEST_1_20261001.txt";
    await runWithTenant(w.tenantId, () => db.transaction(async (tx) => {
      for (const [emp, no, slip] of [[w.empOk, "EMP-M9-1", w.slipOk], [w.empOk2, "EMP-M9-2", w.slipOk2]] as const) {
        await tx.execute(sql`
          INSERT INTO payroll.disbursement_transfers (tenant_id, run_id, slip_id, employee_id, employee_no, beneficiary_name, amount_minor, ifsc, account_last4, file_format, file_reference, status, attempt_no, created_by, updated_by)
          VALUES (${w.tenantId}::uuid, ${w.runId}::uuid, ${slip}::uuid, ${emp}::uuid, ${no}, 'Test Payee', ${net.toString()}::bigint, 'SBIN0000001', '1234', 'nach', ${fileRef}, 'sent', 1, ${MAKER}::uuid, ${MAKER}::uuid)`);
      }
    }));
    await queue.publish(COMMANDS.nachReturnProcess, {
      messageId: randomUUID(), type: COMMANDS.nachReturnProcess, tenantId: w.tenantId, actorId: DISBURSER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        runId: w.runId, fileHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), fileReference: fileRef,
        records: [
          { reference: "EMP-M9-1", amountMinor: net.toString(), statusCode: "0", reasonCode: "", reasonText: "" },
          { reference: "EMP-M9-2", amountMinor: net.toString(), statusCode: "1", reasonCode: "R02", reasonText: "Account closed" },
        ],
        summary: { credited: 1, returned: 1, unmatched: 0 },
      },
    });
    await memQueue.drain();
    expect(await slipStatus(w, w.slipOk)).toBe("paid");
    expect(await slipStatus(w, w.slipOk2)).not.toBe("paid");
    expect((await auditsOf(w.tenantId, "slips_marked_paid"))[0]!.payload).toMatchObject({ resourceId: w.runId, detail: { source: "nach_return", slipsMarkedPaid: 1 } });
  });

  it("a manual reconcile of a sent transfer as success marks its slip paid", async () => {
    const w = await seedRun(randomUUID(), false);
    await approveAndDisburse(w);
    const transferId = randomUUID();
    await runWithTenant(w.tenantId, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.disbursement_transfers (id, tenant_id, run_id, slip_id, employee_id, employee_no, beneficiary_name, amount_minor, ifsc, account_last4, file_format, file_reference, status, attempt_no, created_by, updated_by)
        VALUES (${transferId}::uuid, ${w.tenantId}::uuid, ${w.runId}::uuid, ${w.slipOk}::uuid, ${w.empOk}::uuid, 'EMP-M9-1', 'Test Payee', ${net.toString()}::bigint, 'SBIN0000001', '1234', 'csv', 'bank.csv', 'sent', 1, ${MAKER}::uuid, ${MAKER}::uuid)`);
    }));
    await queue.publish(COMMANDS.disbursementTransferReconcile, {
      messageId: randomUUID(), type: COMMANDS.disbursementTransferReconcile, tenantId: w.tenantId, actorId: DISBURSER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { transferId, outcome: "success", reason: "Credit seen on the bank statement", reasonCode: "OK" },
    });
    await memQueue.drain();
    expect(await slipStatus(w, w.slipOk)).toBe("paid");
    expect(await slipStatus(w, w.slipOk2)).not.toBe("paid");
  });
});

describe("explicit override", () => {
  it("a payroll admin can force the mode; the change is audited with before and after; null clears it back to derived", async () => {
    const tenantId = randomUUID();
    hasFinance.set(tenantId, true);
    const headers = bearer(tenantId, CHECKER, ["payroll_admin"]);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/ledger-mode", headers })).json()).toEqual({ mode: "finance", source: "derived", override: null, hasFinance: true });

    const put = await app.inject({ method: "PUT", url: "/v1/payroll/settings", headers, payload: { protectedNetFloorMinor: 0, ledgerModeOverride: "export" } });
    await memQueue.drain();
    expect(put.statusCode).toBe(202);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/ledger-mode", headers })).json()).toEqual({ mode: "export", source: "override", override: "export", hasFinance: null });
    expect((await app.inject({ method: "GET", url: "/v1/payroll/settings", headers })).json().ledgerModeOverride).toBe("export");
    expect((await auditsOf(tenantId, "ledger_mode_changed"))[0]!.payload).toMatchObject({ before: null, after: "export" });

    await app.inject({ method: "PUT", url: "/v1/payroll/settings", headers, payload: { protectedNetFloorMinor: 0, ledgerModeOverride: null } });
    await memQueue.drain();
    expect((await app.inject({ method: "GET", url: "/v1/payroll/ledger-mode", headers })).json()).toMatchObject({ mode: "finance", source: "derived" });
    expect((await auditsOf(tenantId, "ledger_mode_changed"))[1]!.payload).toMatchObject({ before: "export", after: null });
  });

  it("settings updates that do not mention the override leave it alone", async () => {
    const tenantId = randomUUID();
    hasFinance.set(tenantId, true);
    const headers = bearer(tenantId, CHECKER, ["payroll_admin"]);
    await app.inject({ method: "PUT", url: "/v1/payroll/settings", headers, payload: { protectedNetFloorMinor: 0, ledgerModeOverride: "export" } });
    await memQueue.drain();
    await app.inject({ method: "PUT", url: "/v1/payroll/settings", headers, payload: { protectedNetFloorMinor: 100 } });
    await memQueue.drain();
    expect((await app.inject({ method: "GET", url: "/v1/payroll/settings", headers })).json().ledgerModeOverride).toBe("export");
  });

  it("a tenant WITH Finance forced to export follows export; a tenant WITHOUT Finance forced to finance follows finance", async () => {
    const a = await seedRun(randomUUID(), true);
    await runWithTenant(a.tenantId, () => db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, protected_net_floor_minor, ledger_mode_override) VALUES (${a.tenantId}::uuid, 0, 'export')`); }));
    await approveAndDisburse(a);
    expect(await eventsOf(a.tenantId, "payroll.run.approved")).toEqual([]);
    expect((await journalRows(a)).map((r) => r.stage)).toEqual(["accrual", "disbursement"]);

    const b = await seedRun(randomUUID(), false);
    await runWithTenant(b.tenantId, () => db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, protected_net_floor_minor, ledger_mode_override) VALUES (${b.tenantId}::uuid, 0, 'finance')`); }));
    await approveAndDisburse(b);
    expect(await eventsOf(b.tenantId, "payroll.run.approved")).toHaveLength(1);
    expect(await journalRows(b)).toEqual([]);
  });
});

describe("finance tenant (every current tenant): behaviour is unchanged", () => {
  let w: World;
  beforeAll(async () => { w = await seedRun(randomUUID(), true); await approveAndDisburse(w); });

  it("approval emits payroll.run.approved with exactly the payload it always had, and stores no journal", async () => {
    const e = await eventsOf(w.tenantId, "payroll.run.approved");
    expect(e).toHaveLength(1);
    expect(e[0]!.payload).toEqual({
      runId: w.runId, month: "2026-09",
      totalGrossMinor: (gross * 2n).toString(), totalNetMinor: (net * 2n).toString(),
      totalEmployerContribMinor: "0", totalEdliMinor: "0", totalEpfAdminMinor: "0", totalUpsPoolMinor: "0",
      employeeDeductionsMinor: expect.any(Object),
      accrualCarriedOnDisbursal: true,
    });
    const split = e[0]!.payload.employeeDeductionsMinor as Record<string, string>;
    expect(Object.values(split).reduce((s, v) => s + BigInt(v), 0n)).toBe((gross - net) * 2n);
  });

  it("disbursement emits payroll.run.disbursed and the EFT instruction, exactly as before", async () => {
    const d = await eventsOf(w.tenantId, "payroll.run.disbursed");
    expect(d).toHaveLength(1);
    expect(d[0]!.payload).toMatchObject({ runId: w.runId, month: "2026-09", totalNetMinor: (net * 2n).toString(), paymentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(d[0]!.payload).not.toHaveProperty("accrualCarriedOnDisbursal");
    const e = await eventsOf(w.tenantId, EFT);
    expect(e).toHaveLength(1);
    expect(e[0]!.payload).toEqual({ payrollRunId: w.runId, amountMinor: (net * 2n).toString(), currency: "INR", mode: "neft", pfmsTxnId: `PAYROLL-${w.runId.slice(0, 8)}` });
    expect(await journalRows(w)).toEqual([]);
    expect(await auditsOf(w.tenantId, "journal_exported")).toEqual([]);
  });

  it("the new endpoints refuse a finance tenant", async () => {
    const dl = await app.inject({ method: "GET", url: `/v1/payroll/runs/${w.runId}/journal-export`, headers: bearer(w.tenantId, MAKER, ["payroll_admin"]) });
    expect(dl.statusCode).toBe(409);
    expect(dl.json().code).toBe("LEDGER_EXPORT_NOT_ENABLED");
    const up = await app.inject({ method: "POST", url: `/v1/payroll/runs/${w.runId}/bank-confirmation`, headers: { ...bearer(w.tenantId, MAKER, ["payroll_admin"]), "content-type": "text/csv" }, payload: "EMP-M9-1" });
    expect(up.statusCode).toBe(409);
    expect(up.json().code).toBe("BANK_CONFIRMATION_NOT_ENABLED");
  });

  it("a bank-confirmation command that bypasses the route is dropped by the consumer; slips stay unpaid", async () => {
    const dlqBefore = memQueue.dlq.length;
    await queue.publish(COMMANDS.runBankConfirmation, {
      messageId: randomUUID(), type: COMMANDS.runBankConfirmation, tenantId: w.tenantId, actorId: DISBURSER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { runId: w.runId, fileHash: "0".repeat(64), records: [{ employeeNo: "EMP-M9-1", amountMinor: null, utr: null, outcome: "success" }] },
    });
    await memQueue.drain();
    expect(await slipStatus(w, w.slipOk)).not.toBe("paid");
    expect(memQueue.dlq.slice(dlqBefore).some((d) => d.topic === COMMANDS.runBankConfirmation && String(d.error).includes("BANK_CONFIRMATION_NOT_ENABLED"))).toBe(true);
  });

  it("slips are still marked paid by finance.payment.made, and by nothing else", async () => {
    expect(await slipStatus(w, w.slipOk)).not.toBe("paid");
    await queue.publish(CONSUMED_EVENTS.financePaymentMade, {
      messageId: randomUUID(), type: CONSUMED_EVENTS.financePaymentMade, tenantId: w.tenantId, actorId: DISBURSER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { payrollRunId: w.runId, outcome: "success" },
    });
    await memQueue.drain();
    expect(await slipStatus(w, w.slipOk)).toBe("paid");
    expect(await slipStatus(w, w.slipOk2)).toBe("paid");
  });

  it("an unreachable module source does not move a finance tenant onto the export path", async () => {
    setModuleKeyFetcher(async () => { throw new Error("admin-service down"); });
    try {
      const x = await seedRun(randomUUID(), true);
      hasFinance.delete(x.tenantId);
      await approveAndDisburse(x);
      expect(await eventsOf(x.tenantId, "payroll.run.approved")).toHaveLength(1);
      expect(await journalRows(x)).toEqual([]);
    } finally {
      setModuleKeyFetcher(async (tid) => (hasFinance.get(tid) === false ? ["hrms", "payroll"] : ["hrms", "payroll", "finance"]));
    }
  });
});
