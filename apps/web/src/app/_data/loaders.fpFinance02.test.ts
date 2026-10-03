import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { path: string; empty: unknown; options: { revalidateSeconds?: number; mapResponse: (p: unknown) => unknown } };
const calls: Call[] = [];
const next = vi.hoisted(() => ({ result: { data: null as unknown, source: "api" as "api" | "error" } }));
vi.mock("./apiClient", () => ({
  fetchJson: vi.fn(async (path: string, empty: unknown, options: Call["options"]) => {
    calls.push({ path, empty, options });
    return next.result.source === "error" ? { data: empty, source: "error" } : { data: options.mapResponse(next.result.data), source: "api" };
  }),
}));

import {
  getFinanceActorNames, getFinanceAuditParaById, getFinanceAuditParaEvents, getFinanceBudgetsForReappropriation,
  getFinanceChequeById, getFinanceGLPage, getFinancePaymentContext, getFinanceVendorById,
} from "./loaders";

const U = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const last = () => calls[calls.length - 1]!;

describe("fp-finance-02 loaders", () => {
  beforeEach(() => { calls.length = 0; next.result = { data: null, source: "api" }; });

  describe("getFinanceActorNames", () => {
    it("does not call the API when there is no valid id", async () => {
      expect(await getFinanceActorNames([null, undefined, "not-a-uuid"])).toEqual({});
      expect(calls).toHaveLength(0);
    });

    it("dedupes, drops non-uuids, caps at 50, and maps {data:[{id,name}]} to a record", async () => {
      next.result = { data: { data: [{ id: U(1), name: "Asha Rao" }, { id: U(2), name: "Dev Menon" }, { id: 3, name: "bad" }] }, source: "api" };
      const out = await getFinanceActorNames([U(1), U(1), U(2), "junk", null]);
      expect(last().path).toBe(`/api/v1/finance/actors?ids=${U(1)},${U(2)}`);
      expect(out).toEqual({ [U(1)]: "Asha Rao", [U(2)]: "Dev Menon" });
      const many = Array.from({ length: 80 }, (_, i) => `${String(10000000 + i)}-0000-4000-8000-000000000000`);
      await getFinanceActorNames(many);
      expect(last().path.split("ids=")[1]!.split(",")).toHaveLength(50);
    });

    it("fails open: a failed lookup is an empty map, never an exception", async () => {
      next.result = { data: null, source: "error" };
      expect(await getFinanceActorNames([U(1)])).toEqual({});
    });
  });

  it("getFinanceGLPage builds a bounded, filtered query and validates the payload", async () => {
    const entry = { id: "j:1", voucherNo: "V", date: "2026-06-01", accountCode: "1000", accountName: "Cash", referenceNo: "V", type: "journal", debit: "1", credit: "0" };
    next.result = { data: { data: [entry], pagination: { limit: 25, offset: 50, total: 60, hasMore: false }, totals: { entryLines: 60, vouchers: 3, accountsActive: 4, debitMinor: "1", creditMinor: "1" } }, source: "api" };
    const r = await getFinanceGLPage({ fy: "2026-27", type: "payment", q: "PV 1", page: 3, pageSize: 25 });
    expect(last().path).toBe("/api/v1/finance/journals/lines?limit=25&offset=50&fy=2026-27&type=payment&q=PV+1");
    expect(last().options.revalidateSeconds).toBeUndefined();
    expect(r.data.entries).toHaveLength(1);
    expect(r.data.totals?.entryLines).toBe(60);
    // a payload that is not the expected shape is an error state, not an empty ledger
    expect(last().options.mapResponse({ data: "x" })).toBeNull();
    expect(last().options.mapResponse({ data: [{ nope: 1 }], pagination: {} })).toBeNull();
  });

  it("getFinanceGLPage clamps a nonsense page to the first page", async () => {
    next.result = { data: { data: [], pagination: { limit: 25, offset: 0, total: 0, hasMore: false } }, source: "api" };
    await getFinanceGLPage({ page: 0, pageSize: 25 });
    expect(last().path).toBe("/api/v1/finance/journals/lines?limit=25&offset=0");
  });

  it("payment context and audit-para events reject a malformed payload (error state, not 'empty history')", async () => {
    await getFinancePaymentContext("p1");
    expect(last().path).toBe("/api/v1/finance/payments/p1/context");
    expect(last().options.mapResponse({ nope: true })).toBeNull();
    expect(last().options.mapResponse({ beneficiary: null, bill: null, approvedBy: null, events: [] })).toEqual({ beneficiary: null, bill: null, approvedBy: null, events: [] });
    await getFinanceAuditParaEvents("a1");
    expect(last().path).toBe("/api/v1/finance/audit-paras/a1/events");
    expect(last().options.mapResponse({ data: [] })).toEqual([]);
    expect(last().options.mapResponse({ rows: [] })).toBeNull();
  });

  it("the re-appropriation budget picker asks for a wide page, so it is not silently cut at the default size", async () => {
    await getFinanceBudgetsForReappropriation();
    expect(last().path).toBe("/api/v1/finance/budgets?limit=500");
  });

  it("workflow detail pages are not data-cached, so an action shows on the next refresh", async () => {
    for (const load of [() => getFinanceChequeById("i1"), () => getFinanceVendorById("v1"), () => getFinanceAuditParaById("a1")]) {
      await load();
      expect(last().options.revalidateSeconds).toBeUndefined();
    }
  });
});
