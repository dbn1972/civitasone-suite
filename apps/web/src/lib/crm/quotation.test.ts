import { describe, it, expect } from "vitest";
import {
  normaliseProduct,
  normaliseProducts,
  isProductSelectable,
  normalisePriceBook,
  normaliseQuotation,
  lineNetMinor,
  lineTaxMinor,
  quotationTotalMinor,
  normaliseApprovals,
  normaliseVersions,
  ApprovalRequiredError,
  type QuotationLine,
} from "./quotation";

describe("quotation normalisers & money math (QP-001..005)", () => {
  it("normalises a product keeping price as a paise string", () => {
    const p = normaliseProduct({ id: "pr1", name: "Widget", code: "W1", priceMinor: 12345, taxRateBps: 1800 });
    expect(p!.priceMinor).toBe("12345");
    expect(p!.taxRateBps).toBe(1800);
    expect(p!.currency).toBe("INR");
  });

  it("only treats enabled, in-window products as selectable", () => {
    const base = normaliseProduct({ id: "p", name: "X", code: "X", enabled: true, activeFrom: "2020-01-01", activeTo: "2100-01-01" })!;
    expect(isProductSelectable(base, new Date("2026-01-01"))).toBe(true);
    expect(isProductSelectable({ ...base, enabled: false }, new Date("2026-01-01"))).toBe(false);
    expect(isProductSelectable({ ...base, activeFrom: "2099-01-01" }, new Date("2026-01-01"))).toBe(false);
    expect(isProductSelectable({ ...base, activeTo: "2021-01-01" }, new Date("2026-01-01"))).toBe(false);
  });

  it("normalises a price book with entries", () => {
    const b = normalisePriceBook({ id: "b1", name: "Gov", segment: "government", entries: [{ productId: "p1", priceMinor: "9900" }] });
    expect(b!.entries).toEqual([{ productId: "p1", priceMinor: "9900" }]);
  });

  // The real backend response shape is `items`, not `entries` (GET /v1/crm/price-books
  // and GET /v1/crm/price-books/:id both attach `items` — see price-books/routes.ts).
  // This is the shape the editor actually receives; the "entries"-keyed case above only
  // covered a shape the real API never sends.
  it("normalises a price book from the real API shape (keyed 'items', not 'entries')", () => {
    const b = normalisePriceBook({ id: "b1", name: "Gov", segment: "government", items: [{ productId: "p1", priceMinor: "9900" }] });
    expect(b!.entries).toEqual([{ productId: "p1", priceMinor: "9900" }]);
  });

  it("computes line net, tax and grand total with BigInt (no float drift)", () => {
    const line: QuotationLine = { productId: "p1", quantity: 3, unitPriceMinor: "10000", taxRateBps: 1800 };
    expect(lineNetMinor(line)).toBe("30000"); // 300.00
    expect(lineTaxMinor(line)).toBe("5400"); // 18% of 300 = 54.00
    expect(quotationTotalMinor([line])).toBe("35400");
  });

  it("rounds tax half-up to the nearest paisa", () => {
    // net = 1 paisa, 50% bps=5000 -> 0.5 paisa -> rounds to 1
    const line: QuotationLine = { productId: "p", quantity: 1, unitPriceMinor: "1", taxRateBps: 5000 };
    expect(lineTaxMinor(line)).toBe("1");
  });

  it("normalises a quotation and clamps unknown status to draft", () => {
    const q = normaliseQuotation({ id: "q1", status: "weird", lines: [{ productId: "p1", quantity: 2, unitPriceMinor: 500, taxRateBps: 0 }] });
    expect(q!.status).toBe("draft");
    expect(q!.lines).toHaveLength(1);
    expect(q!.version).toBe(1);
  });

  it("normalises approvals filtering unknown types, and versions", () => {
    const a = normaliseApprovals([{ quotationId: "q1", type: "discount", reason: "big deal" }, { quotationId: "q1", type: "bogus" }]);
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("discount");
    const v = normaliseVersions({ versions: [{ version: 2, status: "sent", totalMinor: "100" }] });
    expect(v[0]).toMatchObject({ version: 2, status: "sent", totalMinor: "100" });
  });

  it("tolerates wrapped products payloads", () => {
    expect(normaliseProducts({ products: [{ name: "A", code: "A" }] })).toHaveLength(1);
    expect(normaliseProducts(null)).toEqual([]);
  });

  it("ApprovalRequiredError is an Error subtype", () => {
    expect(new ApprovalRequiredError("x")).toBeInstanceOf(Error);
  });
});
