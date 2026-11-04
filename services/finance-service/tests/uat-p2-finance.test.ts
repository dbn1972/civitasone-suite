/**
 * UAT Phase 2, finance (agent A): regressions for the screen-UAT findings, against the test DB.
 *   A1  J6 / D10  the voucher narration is kept; J6 / D4 the checker's pending-journal queue
 *   A4  D01 / D02 dashboard expenditure = expense heads only; pending sanctions count every undecided status
 *   A5  chart of accounts: capital 1xxx heads are assets; statements: a 2xxx expense head is expenditure
 *   A6  general ledger "Accounts Active" counts heads, not spellings of a head (code vs UUID)
 *   A7  D20 budget monitoring shows what the GL posted against the head's budget estimate
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";
import { scoped } from "./_tenant.js";
import { bearer } from "./_fp02.js";
import { financeJournals, financeLedger } from "../src/modules/gl/schema.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { financeHeads, financeSanctions, financeBudgets } from "../src/modules/budget/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { bookedLine } from "../src/modules/budget/monitoring-books.js";
import { financeBills, financePayments } from "../src/modules/payments/schema.js";
import { postJournalBody } from "../src/modules/gl/validators.js";
import { withVoucherNarration } from "../src/modules/gl/commands.js";
import { deriveStatementType } from "../src/modules/gl/queries.js";
import { natureOf } from "../src/modules/financial-statements/routes.js";
import { headNatureOf } from "../src/shared/head-nature.js";
import { expenseHeadIds, PENDING_SANCTION_STATUSES } from "../src/modules/dashboard/queries.js";

// gl.finance_journals and gl.finance_ledger are append-only, so every run uses fresh tenants.
const T = randomUUID();
const OTHER = randomUUID();
const MAKER = "00000000-0f2a-4000-8000-0000000000a1";
const CHECKER = "00000000-0f2a-4000-8000-0000000000a2";
const H = {
  dep: randomUUID(), cash: randomUUID(), edu: randomUUID(), ap: randomUUID(), fixed: randomUUID(), accum: randomUUID(), noBe: randomUUID(),
};
let app: Awaited<ReturnType<typeof buildApp>>;
const as = (actor: string, roles: string[], tenant = T) => bearer(tenant, actor, roles);
const get = (url: string, headers: Record<string, string>) => app.inject({ method: "GET", url, headers });

function journal(over: Partial<typeof financeJournals.$inferInsert> & { lines: Array<Record<string, unknown>> }) {
  return {
    id: randomUUID(), tenantId: T, voucherNo: `V-${randomUUID().slice(0, 8)}`, type: "journal", postingDate: "2026-09-10",
    status: "posted", createdBy: MAKER, updatedBy: MAKER, ...over,
  } as typeof financeJournals.$inferInsert;
}
const ledger = (headId: string, dr: bigint, cr: bigint) => ({
  tenantId: T, headId, debitMinor: dr, creditMinor: cr, voucherNo: "L-1", postingDate: "2026-09-10", createdBy: MAKER, updatedBy: MAKER,
});
async function bill(headId: string, netMinor: bigint, status: string): Promise<string> {
  const id = randomUUID();
  await scoped(T, (tx) => tx.insert(financeBills).values({
    id, tenantId: T, billNo: `B-${id.slice(0, 8)}`, vendorId: randomUUID(), headId, grossMinor: netMinor, netMinor,
    billDate: "2026-09-10", status, createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
/** As in tests/dom-024: every handler runs under the message's tenant GUC, like production's wrapped queue. */
function tenantWrappedQueue(opts?: { maxAttempts?: number }): MemoryQueue {
  const q = new MemoryQueue(opts);
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

beforeAll(async () => {
  app = await buildApp();
  await scoped(T, (tx) => tx.insert(financeHeads).values([
    { id: H.dep, tenantId: T, code: "5100", name: "Depreciation Expense", level: 0, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    { id: H.cash, tenantId: T, code: "1100", name: "Cash / Bank", level: 0, classification: "asset", createdBy: MAKER, updatedBy: MAKER },
    { id: H.edu, tenantId: T, code: "2202", name: "General Education", level: 0, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    { id: H.ap, tenantId: T, code: "2050", name: "Accounts Payable", level: 0, classification: "liability", createdBy: MAKER, updatedBy: MAKER },
    { id: H.fixed, tenantId: T, code: "1200", name: "Fixed Assets (Gross)", level: 0, classification: "capital", createdBy: MAKER, updatedBy: MAKER },
    { id: H.accum, tenantId: T, code: "1250", name: "Accumulated Depreciation", level: 0, classification: "capital", createdBy: MAKER, updatedBy: MAKER },
    { id: H.noBe, tenantId: T, code: "2210", name: "Medical", level: 0, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
  ]));
  // GFR (UAT T-PERIOD D-03): the voucher debits 5100, so the head needs a budget provision for FY 2026-27
  await scoped(T, (tx) => tx.insert(financeBudgets).values({ tenantId: T, headId: H.dep, fy: "2026-27", beMinor: 10n ** 12n, reMinor: 10n ** 12n, createdBy: MAKER, updatedBy: MAKER }));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("A1 (J6, D10): the narration typed on the voucher form is stored", () => {
  const body = {
    type: "journal", postingDate: "2026-09-10", narration: "  JV cash to bank transfer  ",
    lines: [{ accountCode: "5100", debitMinor: "250000", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "250000", narration: "own line note" }],
  };

  it("the schema keeps the voucher narration (it used to be stripped) and a blank one is simply none", () => {
    expect(postJournalBody.parse(body).narration).toBe("JV cash to bank transfer");
    expect(postJournalBody.parse({ ...body, narration: "   " }).narration).toBeUndefined();
    expect(() => postJournalBody.parse({ ...body, narration: "x".repeat(501) })).toThrow();
  });

  it("the voucher narration is copied onto every line without its own", () => {
    const lines = withVoucherNarration(postJournalBody.parse(body));
    expect(lines.map((l) => l.narration)).toEqual(["JV cash to bank transfer", "own line note"]);
  });

  it("POST /v1/finance/journals publishes the draft with the narration on its lines", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/journals", headers: { ...as(MAKER, ["finance_officer"]), "x-idempotency-key": randomUUID() }, payload: body,
      });
      expect(res.statusCode).toBe(202);
      const msg = spy.mock.calls.map((c) => c[1] as { type: string; payload: { lines: Array<{ narration?: string }> } }).find((m) => m.type === "finance.gl.create");
      expect(msg?.payload.lines.map((l) => l.narration)).toEqual(["JV cash to bank transfer", "own line note"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("A1 (J6, D4): GET /v1/finance/journals/pending -- the checker's queue", () => {
  const pendingId = randomUUID();
  beforeAll(async () => {
    await scoped(T, (tx) => tx.insert(financeJournals).values([
      journal({ id: pendingId, voucherNo: `DRAFT-${pendingId}`, status: "pending_approval", lines: [
        { accountCode: "5100", debitMinor: "250000", creditMinor: "0", narration: "JV cash to bank transfer" },
        { accountCode: "1100", debitMinor: "0", creditMinor: "250000", narration: "JV cash to bank transfer" },
      ] }),
      journal({ lines: [{ accountCode: "5100", debitMinor: "1", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "1" }] }),
    ]));
  });

  it("lists only pending drafts, with narration, total and the draft number hidden", async () => {
    const res = await get("/v1/finance/journals/pending", as(CHECKER, ["finance_admin"]));
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual([pendingId]);
    expect(rows[0]).toMatchObject({ voucherNo: null, narration: "JV cash to bank transfer", totalMinor: "250000", isOwn: false, postingDate: "2026-09-10" });
    expect((rows[0]!.lines as unknown[]).length).toBe(2);
  });

  it("tells the maker the draft is their own (the screen then offers no Approve)", async () => {
    const rows = (await get("/v1/finance/journals/pending", as(MAKER, ["finance_officer"]))).json().data as Array<{ isOwn: boolean }>;
    expect(rows[0]!.isOwn).toBe(true);
  });

  it("is tenant-scoped and role-gated", async () => {
    expect((await get("/v1/finance/journals/pending", as(CHECKER, ["finance_admin"], OTHER))).json().data).toEqual([]);
    expect((await get("/v1/finance/journals/pending", as(CHECKER, ["citizen"]))).statusCode).toBe(403);
  });
});

describe("A6: general ledger Accounts Active counts distinct heads", () => {
  it("a head referenced by code in one line and by UUID in another is one account", async () => {
    await scoped(T, (tx) => tx.insert(financeJournals).values([
      journal({ voucherNo: "A6-1", postingDate: "2025-05-01", lines: [{ accountCode: "5100", debitMinor: "100", creditMinor: "0" }, { accountCode: "9999", debitMinor: "0", creditMinor: "100" }] }),
      journal({ voucherNo: "A6-2", postingDate: "2025-05-02", lines: [{ accountCode: H.dep, debitMinor: "100", creditMinor: "0" }, { accountCode: "9999", debitMinor: "0", creditMinor: "100" }] }),
    ]));
    const res = await get("/v1/finance/journals/lines?fy=2025-26", as(CHECKER, ["finance_officer"]));
    expect(res.statusCode).toBe(200);
    // 5100 and its UUID are the same head; 9999 matches no head and is counted once.
    expect(res.json().totals).toMatchObject({ vouchers: 2, accountsActive: 2 });
  });
});

describe("A4 (D01, D02): finance dashboard figures", () => {
  beforeAll(async () => {
    await scoped(T, (tx) => tx.insert(financeLedger).values([
      ledger(H.dep, 10000n, 0n), ledger(H.cash, 0n, 10000n),        // expense 100
      ledger(H.edu, 27000n, 0n), ledger(H.ap, 0n, 27000n),          // expense (2202 expense head) 270
      ledger(H.cash, 500000n, 0n), ledger(H.ap, 0n, 500000n),       // not expenditure
      ledger(H.dep, 0n, 1000n), ledger(H.cash, 1000n, 0n),          // a reversal on the expense head
    ]));
    const s = (status: string) => ({ tenantId: T, sanctionNo: `S-${randomUUID().slice(0, 6)}`, purpose: "p", headId: H.edu, amountMinor: 100n, status, createdBy: MAKER, updatedBy: MAKER });
    await scoped(T, (tx) => tx.insert(financeSanctions).values([s("pending_approval"), s("draft"), s("approved"), s("cancelled")]));
    // one payment this month, one two months ago
    const p = (billId: string, createdAt: Date) => ({ tenantId: T, billId, mode: "NEFT", amountMinor: 100n, createdAt, createdBy: MAKER, updatedBy: MAKER });
    const [now, old] = [await bill(H.edu, 100n, "paid"), await bill(H.edu, 100n, "paid")];
    await scoped(T, (tx) => tx.insert(financePayments).values([p(now, new Date()), p(old, new Date(Date.now() - 62 * 24 * 3600 * 1000))]));
  });

  it("expenditure is net debits on expense heads only; pending counts draft/pending/pending_approval", async () => {
    const res = await get("/v1/finance/dashboard?fy=2026-27", as(CHECKER, ["finance_officer"]));
    expect(res.statusCode).toBe(200);
    // all-heads debits would be 538000 paise; expense heads net of the reversal are 36000.
    expect(res.json()).toMatchObject({ totalExpenditure: 36000, pendingSanctions: 2 });
  });

  it("payments this month counts only this calendar month's payments", async () => {
    const res = await get("/v1/finance/dashboard?fy=2026-27", as(CHECKER, ["finance_officer"]));
    expect(res.json().paymentsThisMonth).toBe(1);
  });

  it("pure rules", () => {
    expect(expenseHeadIds([
      { id: "a", code: "5100", classification: "expense" }, { id: "b", code: "1100", classification: "asset" },
      { id: "c", code: "2202", classification: "expense" }, { id: "d", code: "2050", classification: "liability" },
      { id: "e", code: "4200", classification: "expense" },
    ])).toEqual(["a", "c", "e"]);
    expect([...PENDING_SANCTION_STATUSES]).toEqual(["draft", "pending", "pending_approval"]);
  });
});

describe("A5: account typing", () => {
  it("chart of accounts: capital heads 1200 / 1250 are assets (they showed as Income)", async () => {
    const res = await get("/v1/finance/accounts?limit=500", as(CHECKER, ["finance_officer"]));
    expect(res.statusCode).toBe(200);
    const byCode = new Map((res.json().data as Array<{ code: string; type: string }>).map((a) => [a.code, a.type]));
    expect(byCode.get("1200")).toBe("asset");
    expect(byCode.get("1250")).toBe("asset");
    expect(byCode.get("2202")).toBe("expense");
    expect(byCode.get("2050")).toBe("liability");
  });

  it("statements list: a 2xxx head classified expense is expenditure, as on the financial statements", () => {
    expect(deriveStatementType("2202", "expense")).toBe("expenditure");
    expect(deriveStatementType("2202-qkawf3", "expense")).toBe("expenditure");
    expect(deriveStatementType("2050", "liability")).toBe("liability");
    expect(deriveStatementType("1200", "capital")).toBe("asset");
    expect(deriveStatementType("4200", "expense")).toBe("expenditure");
    expect(deriveStatementType("3001", "equity")).toBe("liability");
    expect(deriveStatementType(null, "revenue")).toBe("income");
    expect(natureOf("2202", "expense")).toBe("expense");
  });

  it("review follow-up: classification case and blanks never change the nature, for every caller", () => {
    expect(headNatureOf("2202", " Expense ")).toBe("expense");
    expect(headNatureOf("4100", "REVENUE")).toBe("income");
    expect(headNatureOf("3001", "Equity")).toBe("equity");
    expect(headNatureOf(null, "ASSET")).toBe("asset");
    expect(natureOf("2202", "EXPENSE")).toBe("expense");
    expect(deriveStatementType("2202", "Expenditure")).toBe("expenditure");
    // the dashboard rule (it passed the stored value raw)
    expect(expenseHeadIds([{ id: "x", code: "2202", classification: "Expense" }, { id: "y", code: "2202", classification: "LIABILITY" }])).toEqual(["x"]);
  });
});

describe("A7 (D20): budget monitoring Expended is read from the books; a booked bill leaves commitment", () => {
  it("expended = ledger net on the head in the FY; committed excludes bills already booked; nothing counted twice", async () => {
    // The ledger already holds the Rs 270 direct JV on 2202 (A4 fixture). Two passed, unpaid bills on 2202:
    // B1 (Rs 500) whose GL journal is posted (booked), B2 (Rs 100) whose journal has not posted yet.
    const b1 = await bill(H.edu, 50000n, "passed");
    const b2 = await bill(H.edu, 10000n, "passed");
    await scoped(T, (tx) => tx.insert(financeJournals).values(journal({
      id: deterministicId(`bill:${b1}`), voucherNo: `BILL-${b1.slice(0, 8)}`, type: "bill",
      lines: [{ accountCode: H.edu, debitMinor: "50000", creditMinor: "0" }, { accountCode: H.ap, debitMinor: "0", creditMinor: "50000" }],
    })));
    await scoped(T, (tx) => tx.insert(financeLedger).values([ledger(H.edu, 50000n, 0n), ledger(H.ap, 0n, 50000n)]));
    // As the bill consumer stores it: both bills' nets are committed on the allocation.
    await scoped(T, (tx) => tx.insert(financeBudgetAllocation).values([
      { tenantId: T, headId: H.edu, fy: "2026-27", allocatedMinor: 27000000n, committedMinor: 60000n, createdBy: MAKER, updatedBy: MAKER },
      { tenantId: T, headId: H.noBe, fy: "2026-27", allocatedMinor: 15000000n, createdBy: MAKER, updatedBy: MAKER },
    ]));
    void b2;
    const res = await get("/v1/finance/budget-monitoring?fy=2026-27&asOf=2026-11-03", as(CHECKER, ["finance_officer"]));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { totals: Record<string, string>; lines: Array<Record<string, string>> };
    const edu = body.lines.find((l) => l.headId === H.edu)!;
    // expended 270 + 500 = 770; committed 600 - 500 (booked) = 100; available = 2,70,000 - 100 - 770.
    expect(edu).toMatchObject({ actualMinor: "77000", committedMinor: "10000", availableMinor: String(27000000 - 10000 - 77000) });
    expect(body.lines.find((l) => l.headId === H.noBe)).toMatchObject({ actualMinor: "0", committedMinor: "0", availableMinor: "15000000" });
    expect(body.totals).toMatchObject({ actualMinor: "77000", committedMinor: "10000" });
    const summary = (await get("/v1/finance/budget-monitoring/summary?fy=2026-27&asOf=2026-11-03", as(CHECKER, ["finance_officer"]))).json();
    expect(summary.totals.actualMinor).toBe("77000");
  });

  it("pure rule: a booked bill moves from commitment to expended, never below zero", () => {
    expect(bookedLine({ allocatedMinor: 1000n, committedMinor: 600n }, 770n, 500n)).toEqual({ allocatedMinor: 1000n, committedMinor: 100n, actualMinor: 770n });
    expect(bookedLine({ allocatedMinor: 1000n, committedMinor: 100n }, 0n, 500n).committedMinor).toBe(0n);
  });
});

describe("J6 reject (final): PATCH /v1/finance/journals/:id/reject and the finance.gl.reject consumer", () => {
  const pending = randomUUID();
  const posted = randomUUID();
  const own = randomUUID();
  const lines = [{ accountCode: H.dep, debitMinor: "4200", creditMinor: "0", narration: "to be rejected" }, { accountCode: H.cash, debitMinor: "0", creditMinor: "4200" }];
  beforeAll(async () => {
    await scoped(T, (tx) => tx.insert(financeJournals).values([
      journal({ id: pending, voucherNo: `DRAFT-${pending}`, status: "pending_approval", postingDate: "2024-05-05", lines }),
      journal({ id: own, voucherNo: `DRAFT-${own}`, status: "pending_approval", postingDate: "2024-05-05", lines, createdBy: CHECKER, updatedBy: CHECKER }),
      journal({ id: posted, voucherNo: `RJ-${posted.slice(0, 8)}`, postingDate: "2024-05-05", lines: lines.map(({ narration: _n, ...l }) => l) }),
    ]));
  });
  const patch = (id: string, payload: unknown, headers = as(CHECKER, ["finance_admin"])) =>
    app.inject({ method: "PATCH", url: `/v1/finance/journals/${id}/reject`, headers, payload: payload as Record<string, unknown> });

  it("route: reason >= 10 chars, approving role, not own, pending only, tenant-scoped", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      expect((await patch(pending, { reason: "too short" })).statusCode).toBe(400);
      expect((await patch(pending, { reason: "Wrong head of account" }, as(MAKER, ["finance_officer"]))).statusCode).toBe(403);
      expect((await patch(own, { reason: "Wrong head of account" })).statusCode).toBe(403);
      expect((await patch(posted, { reason: "Wrong head of account" })).statusCode).toBe(409);
      expect((await patch(pending, { reason: "Wrong head of account" }, as(CHECKER, ["finance_admin"], OTHER))).statusCode).toBe(404);
      const ok = await patch(pending, { reason: "  Wrong head of account  " });
      expect(ok.statusCode).toBe(202);
      const msg = spy.mock.calls.map((c) => c[1] as { type: string; payload: Record<string, unknown> }).find((m) => m.type === COMMANDS.journalReject);
      expect(msg?.payload).toMatchObject({ id: pending, reason: "Wrong head of account" });
    } finally {
      spy.mockRestore();
    }
  });

  it("consumer: a distinct checker rejects -> status rejected with reason, audit event, nothing posted; then read-only", async () => {
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerGlConsumers(q);
    await q.start();
    await q.publish(COMMANDS.journalReject, {
      messageId: randomUUID(), type: COMMANDS.journalReject, tenantId: T, actorId: CHECKER, correlationId: `corr-rej-${pending}`, schemaVersion: "1.0",
      payload: { id: pending, tenantId: T, reason: "Wrong head of account" },
    });
    // the maker cannot reject their own draft (SoD) -- dead-lettered, unchanged
    await q.publish(COMMANDS.journalReject, {
      messageId: randomUUID(), type: COMMANDS.journalReject, tenantId: T, actorId: CHECKER, correlationId: "corr-rej-own", schemaVersion: "1.0",
      payload: { id: own, tenantId: T, reason: "Rejecting my own journal" },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.map((d) => String(d.error))).toEqual([expect.stringMatching(/MAKER_CHECKER_VIOLATION/)]);

    const rows = await scoped(T, (tx) => tx.select().from(financeJournals).where(inArray(financeJournals.id, [pending, own])));
    const rej = rows.find((r) => r.id === pending)!;
    expect(rej).toMatchObject({ status: "rejected", rejectionReason: "Wrong head of account", updatedBy: CHECKER, createdBy: MAKER, voucherNo: `DRAFT-${pending}` });
    expect(rows.find((r) => r.id === own)!.status).toBe("pending_approval");
    const audit = await scoped(T, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, `corr-rej-${pending}`)));
    expect(audit.map((a) => (a.payload as { action?: string }).action)).toContain("reject_journal");

    // read-only for audit: the database refuses any change, including a late approval
    await expect(scoped(T, (tx) => tx.update(financeJournals).set({ status: "posted" }).where(eq(financeJournals.id, pending)))).rejects.toThrow();
    await expect(scoped(T, (tx) => tx.update(financeJournals).set({ rejectionReason: "edited" }).where(eq(financeJournals.id, pending)))).rejects.toThrow();
    const approve = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${pending}/approve`, headers: as(CHECKER, ["finance_admin"]) });
    expect(approve.statusCode).toBe(409);
    // migration 0158: the database itself refuses a rejection without a 10+ character reason
    await expect(scoped(T, (tx) => tx.update(financeJournals).set({ status: "rejected", rejectionReason: "short" }).where(eq(financeJournals.id, own)))).rejects.toThrow();
    await expect(scoped(T, (tx) => tx.update(financeJournals).set({ status: "rejected" }).where(eq(financeJournals.id, own)))).rejects.toThrow();
    // a posted journal can never become rejected
    await expect(scoped(T, (tx) => tx.update(financeJournals).set({ status: "rejected" }).where(eq(financeJournals.id, posted)))).rejects.toThrow();
  });

  it("F107: the maker approving their own journal is a synchronous 403 and nothing is queued", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${own}/approve`, headers: as(CHECKER, ["finance_admin"]) });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "MAKER_CHECKER_VIOLATION", message: expect.stringMatching(/different officer must approve or reject/) });
      expect(spy.mock.calls.filter((c) => (c[1] as { type?: string }).type === COMMANDS.journalApprove)).toHaveLength(0);
      const [row] = await scoped(T, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, own)));
      expect(row?.status).toBe("pending_approval");
    } finally {
      spy.mockRestore();
    }
  });

  it("the rejected journal is listed (read-only, with reason) and kept off the pending queue and the ledger", async () => {
    const rej = (await get("/v1/finance/journals/rejected", as(MAKER, ["finance_officer"]))).json().data as Array<Record<string, unknown>>;
    expect(rej.find((r) => r.id === pending)).toMatchObject({ rejectionReason: "Wrong head of account", isOwn: true, decidedBy: CHECKER });
    const pend = (await get("/v1/finance/journals/pending", as(CHECKER, ["finance_admin"]))).json().data as Array<{ id: string }>;
    expect(pend.map((p) => p.id)).not.toContain(pending);
    const gl = (await get("/v1/finance/journals/lines?q=to%20be%20rejected", as(CHECKER, ["finance_officer"]))).json();
    expect(gl.totals.entryLines).toBe(0);
  });
});
