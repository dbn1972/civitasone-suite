import { describe, it, expect } from "vitest";
import { parseOpaqueRef, opaqueRefHref } from "./refs";

describe("parseOpaqueRef / opaqueRefHref (GAP-PROCUREMENT-RFQ-02 / DETAIL-04)", () => {
  it("splits a well-formed opaque ref into type + id", () => {
    expect(parseOpaqueRef("procurement_indent:abc-123")).toEqual({ type: "procurement_indent", id: "abc-123" });
  });

  it("treats a '...:undefined' ref as absent", () => {
    expect(parseOpaqueRef("procurement_indent:undefined")).toBeNull();
  });

  it("treats an empty-id ref as absent", () => {
    expect(parseOpaqueRef("procurement_indent:")).toBeNull();
  });

  it("returns null for a prefix-less string", () => {
    expect(parseOpaqueRef("abc-123")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseOpaqueRef(null)).toBeNull();
    expect(parseOpaqueRef(undefined)).toBeNull();
  });

  it("builds the indent detail href for a procurement_indent ref", () => {
    expect(opaqueRefHref("procurement_indent:ind-9")).toBe("/procurement/indents/ind-9");
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-06: a bill's PO reference links to the purchase order.
  it("builds the purchase-order detail href for a procurement_po ref with a UUID id", () => {
    expect(opaqueRefHref("procurement_po:5b1c2d3e-0000-4000-8000-000000000000")).toBe(
      "/procurement/orders/5b1c2d3e-0000-4000-8000-000000000000",
    );
  });

  it("gives a procurement_po ref that is not a UUID no link (there is no page to open)", () => {
    expect(opaqueRefHref("procurement_po:abc-123")).toBeNull();
    expect(opaqueRefHref("procurement_po:PO-2026-014")).toBeNull();
    expect(opaqueRefHref("procurement_po:undefined")).toBeNull();
  });

  it("returns null href for an unknown ref type (no dead link)", () => {
    expect(opaqueRefHref("procurement_widget:x")).toBeNull();
  });

  it("returns null href for a malformed ref", () => {
    expect(opaqueRefHref("procurement_indent:undefined")).toBeNull();
  });
});
