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
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { bearer } from "./_fp02.js";
import { financeJournals, financeLedger } from "../src/modules/gl/schema.js";
import { financeHeads, financeSanctions, financeBudgets } from "../src/modules/budget/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { postJournalBody } from "../src/modules/gl/validators.js";
import { withVoucherNarration } from "../src/modules/gl/commands.js";
import { deriveStatementType } from "../src/modules/gl/queries.js";
import { natureOf } from "../src/modules/financial-statements/routes.js";
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
  });

  it("expenditure is net debits on expense heads only; pending counts draft/pending/pending_approval", async () => {
    const res = await get("/v1/finance/dashboard?fy=2026-27", as(CHECKER, ["finance_officer"]));
    expect(res.statusCode).toBe(200);
    // all-heads debits would be 538000 paise; expense heads net of the reversal are 36000.
    expect(res.json()).toMatchObject({ totalExpenditure: 36000, pendingSanctions: 2 });
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
});

describe("A7 (D20): budget monitoring shows the GL posting beside Expended", () => {
  it("postedMinor is the GL figure against the head's budget estimate; null when the head has no estimate", async () => {
    await scoped(T, (tx) => tx.insert(financeBudgetAllocation).values([
      { tenantId: T, headId: H.edu, fy: "2026-27", allocatedMinor: 27000000n, createdBy: MAKER, updatedBy: MAKER },
      { tenantId: T, headId: H.noBe, fy: "2026-27", allocatedMinor: 15000000n, createdBy: MAKER, updatedBy: MAKER },
    ]));
    await scoped(T, (tx) => tx.insert(financeBudgets).values({ tenantId: T, headId: H.edu, fy: "2026-27", beMinor: 30000000n, utilisedMinor: 27000n, createdBy: MAKER, updatedBy: MAKER }));
    const res = await get("/v1/finance/budget-monitoring?fy=2026-27&asOf=2026-11-03", as(CHECKER, ["finance_officer"]));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { totals: { postedMinor: string }; lines: Array<{ headId: string; actualMinor: string; postedMinor: string | null; availableMinor: string }> };
    const edu = body.lines.find((l) => l.headId === H.edu)!;
    expect(edu).toMatchObject({ actualMinor: "0", postedMinor: "27000", availableMinor: "27000000" });
    expect(body.lines.find((l) => l.headId === H.noBe)!.postedMinor).toBeNull();
    expect(body.totals.postedMinor).toBe("27000");
  });
});
