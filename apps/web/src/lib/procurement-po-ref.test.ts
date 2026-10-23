import { describe, it, expect } from "vitest";
import { poIdFromRef, poHrefFromRef } from "./procurement-po-ref";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("poIdFromRef / poHrefFromRef (GAP-PROCUREMENT-CONTRACTS-05)", () => {
  it("extracts the id from the procurement_po composite and from a bare uuid", () => {
    expect(poIdFromRef(`procurement_po:${ID}`)).toBe(ID);
    expect(poIdFromRef(ID)).toBe(ID);
    expect(poHrefFromRef(`procurement_po:${ID}`)).toBe(`/procurement/orders/${ID}`);
  });

  it("is case-insensitive on input and returns a lower-case id", () => {
    expect(poIdFromRef(ID.toUpperCase())).toBe(ID);
  });

  it("returns null for empty, free-text and malformed references (never a guessed route)", () => {
    for (const bad of [null, undefined, "", "  ", "PO-2026-0042", "procurement_indent:" + ID, ID + "/../x", "javascript:alert(1)", `${ID}?x=1`]) {
      expect(poIdFromRef(bad)).toBeNull();
      expect(poHrefFromRef(bad)).toBeNull();
    }
  });
});
