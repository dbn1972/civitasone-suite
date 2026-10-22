import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as qp from "./quotation";

// CRM gap cluster 08 (W2 rescan): wire contract of the price-book / product editors.

function res(body: unknown, init: { status?: number } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const bodyOf = (call = 0) => JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string) as Record<string, unknown>;

const BOOK: qp.PriceBook = {
  id: "b1",
  name: "  Gov  ",
  segment: "",
  currency: "INR",
  geography: " north ",
  channel: "",
  entries: [{ productId: "pr1", priceMinor: "9950" }],
  enabled: true,
  version: 4,
  updatedBy: "0c1d2e3f-0000-4000-8000-0000000000aa",
  updatedByName: "Ravi Admin",
  updatedAt: "2026-03-10T08:00:00.000Z",
};

describe("price-book wire contract", () => {
  it("CREATE leaves a blank Segment / Geography / Channel out (the API rejects '' with 400)", () => {
    const body = JSON.parse(qp.serialisePriceBook(BOOK, "create")) as Record<string, unknown>;
    expect(body).toEqual({
      name: "Gov",
      geography: "north",
      currency: "INR",
      enabled: true,
      entries: [{ productId: "pr1", priceMinor: "9950" }],
    });
    expect("segment" in body).toBe(false);
    expect("channel" in body).toBe(false);
  });

  it("UPDATE sends null for a blank scope so a cleared field actually clears", () => {
    const body = JSON.parse(qp.serialisePriceBook(BOOK, "update")) as Record<string, unknown>;
    expect(body.segment).toBeNull();
    expect(body.channel).toBeNull();
    expect(body.geography).toBe("north");
  });

  it("never sends audit fields back (id / version / updatedBy / updatedByName / updatedAt)", () => {
    const keys = Object.keys(JSON.parse(qp.serialisePriceBook(BOOK, "update", "why")));
    for (const k of ["id", "version", "updatedBy", "updatedByName", "updatedAt"]) expect(keys).not.toContain(k);
  });

  it("carries the trimmed live-edit reason on update, and no reason key otherwise", () => {
    expect(JSON.parse(qp.serialisePriceBook(BOOK, "update", "  Annual revision  ")).reason).toBe("Annual revision");
    expect("reason" in JSON.parse(qp.serialisePriceBook(BOOK, "update", "   "))).toBe(false);
    expect("reason" in JSON.parse(qp.serialisePriceBook(BOOK, "update"))).toBe(false);
  });

  it("updatePriceBook PATCHes with the reason; createPriceBook POSTs without one", async () => {
    fetchMock.mockResolvedValueOnce(res({}, { status: 202 }));
    await qp.updatePriceBook("b1", BOOK, { reason: "Annual revision" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/crm/price-books/b1");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("PATCH");
    expect(bodyOf(0).reason).toBe("Annual revision");
    fetchMock.mockResolvedValueOnce(res({}, { status: 202 }));
    await qp.createPriceBook(BOOK);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe("POST");
    expect("reason" in bodyOf(1)).toBe(false);
  });

  it("normalises the editor's NAME beside the id, and omits it when the API sent none", () => {
    const named = qp.normalisePriceBook({ id: "b1", name: "Gov", updatedBy: "u1", updatedByName: "Ravi Admin" });
    expect(named!.updatedByName).toBe("Ravi Admin");
    const unnamed = qp.normalisePriceBook({ id: "b1", name: "Gov", updatedBy: "u1", updatedByName: null });
    expect(unnamed!.updatedBy).toBe("u1");
    expect("updatedByName" in unnamed!).toBe(false);
  });
});

describe("price-book change history", () => {
  it("normalises entries: names, reason, field changes, price moves (minor strings) and the exact count", () => {
    const rows = qp.normalisePriceBookHistory({
      data: [
        {
          id: "h2", version: 3, action: "update", changedBy: "u2", changedByName: "Rohit Sen", changedAt: "2026-03-10T08:00:00.000Z",
          reason: "Revised FY27 tariff",
          changes: {
            fields: [{ field: "priority", from: 5, to: 9 }, { field: "segment", from: null, to: "gov" }, { field: "", from: 1, to: 2 }],
            prices: [{ productId: "pr1", fromMinor: "90000", toMinor: 85000 }, { productId: "pr2", fromMinor: null, toMinor: "70000" }, { fromMinor: "1", toMinor: "2" }],
            priceChangeCount: 7,
          },
        },
        { id: "h1", version: 1, action: "weird", changedBy: "u1", changedAt: "2026-03-01T08:00:00.000Z", changes: {} },
        { version: 9 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "h2", version: 3, action: "update", changedByName: "Rohit Sen", changedAt: "2026-03-10T08:00:00.000Z",
      reason: "Revised FY27 tariff",
      fields: [{ field: "priority", from: 5, to: 9 }, { field: "segment", from: null, to: "gov" }],
      prices: [{ productId: "pr1", fromMinor: "90000", toMinor: "85000" }, { productId: "pr2", fromMinor: null, toMinor: "70000" }],
      priceChangeCount: 7,
    });
    // An unrecognised action degrades to a plain edit; an editor with no resolved name carries no name (never the id).
    expect(rows[1]!.action).toBe("update");
    expect("changedByName" in rows[1]!).toBe(false);
    expect(rows[1]!.priceChangeCount).toBe(0);
  });

  it("getPriceBookHistory reads the per-book history and reports a failed read as an error, not empty", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [{ id: "h1", version: 1, action: "create", changedAt: "2026-03-01T08:00:00.000Z", changes: {} }] }));
    const ok = await qp.getPriceBookHistory("b/1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/crm/price-books/b%2F1/history");
    expect(ok.source).toBe("api");
    expect(ok.data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({}, { status: 403 }));
    expect(await qp.getPriceBookHistory("b1")).toEqual({ data: [], source: "error" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await qp.getPriceBookHistory("b1")).source).toBe("error");
  });
});

describe("product wire contract and usage", () => {
  const PRODUCT: qp.Product = {
    id: "pr1", category: "", code: " SKU-1 ", name: " Widget ", unit: "", taxRateBps: 1800, hsnSac: "",
    priceMinor: "10000", currency: "INR", activeFrom: "", activeTo: "2026-12-31", enabled: true,
    updatedBy: "0c1d2e3f-0000-4000-8000-0000000000aa", updatedByName: "Ravi Admin", updatedAt: "2026-03-10T08:00:00.000Z",
  };

  it("CREATE omits blank Category / Unit / HSN / dates (the API rejects '' with 400)", () => {
    const body = JSON.parse(qp.serialiseProduct(PRODUCT, "create")) as Record<string, unknown>;
    expect(body).toEqual({ code: "SKU-1", name: "Widget", taxRateBps: 1800, priceMinor: "10000", currency: "INR", activeTo: "2026-12-31", enabled: true });
  });

  it("UPDATE clears a blank clearable field with null, never an empty string; a blank unit is left alone", () => {
    const body = JSON.parse(qp.serialiseProduct(PRODUCT, "update")) as Record<string, unknown>;
    expect(body.category).toBeNull();
    expect(body.hsnSac).toBeNull();
    expect(body.activeFrom).toBeNull();
    expect(body.activeTo).toBe("2026-12-31");
    expect("unit" in body).toBe(false);
    expect("code" in body).toBe(false);
    for (const k of ["id", "updatedBy", "updatedByName", "updatedAt"]) expect(k in body).toBe(false);
  });

  it("normalises the product editor's name beside the id", () => {
    const p = qp.normaliseProduct({ id: "pr1", name: "W", code: "W1", updatedBy: "u1", updatedByName: "Ravi Admin", updatedAt: "2026-03-10T08:00:00.000Z" });
    expect(p!.updatedByName).toBe("Ravi Admin");
    expect(qp.normaliseProduct({ id: "pr1", name: "W", code: "W1", updatedBy: "u1" })!.updatedByName).toBeUndefined();
  });

  it("getProductUsage returns the counts, and says unknown (null/error) rather than 'unused' on any failure", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: { quotations: 3, priceBooks: 1 } }));
    expect(await qp.getProductUsage("pr/1")).toEqual({ data: { quotations: 3, priceBooks: 1 }, source: "api" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/crm/products/pr%2F1/usage");
    fetchMock.mockResolvedValueOnce(res({}, { status: 403 }));
    expect(await qp.getProductUsage("pr1")).toEqual({ data: null, source: "error" });
    fetchMock.mockResolvedValueOnce(res({ data: { quotations: "3" } }));
    expect(await qp.getProductUsage("pr1")).toEqual({ data: null, source: "error" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await qp.getProductUsage("pr1")).toEqual({ data: null, source: "error" });
  });
});
