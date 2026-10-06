import { describe, it, expect } from "vitest";
import { isCssColour } from "./colour";

describe("isCssColour (GAP-THEMES-TOKENS-04)", () => {
  it("accepts 3/6 digit hex", () => {
    expect(isCssColour("#fff")).toBe(true);
    expect(isCssColour("#ffffff")).toBe(true);
    expect(isCssColour("#0055aa")).toBe(true);
  });

  it("accepts 4/8 digit hex (with alpha)", () => {
    expect(isCssColour("#ffff")).toBe(true);
    expect(isCssColour("#ffffff80")).toBe(true);
  });

  it("accepts rgb()/rgba()", () => {
    expect(isCssColour("rgb(1 2 3)")).toBe(true);
    expect(isCssColour("rgb(0,0,0)")).toBe(true);
    expect(isCssColour("rgba(0, 0, 0, 0.5)")).toBe(true);
  });

  it("accepts hsl()/hsla()", () => {
    expect(isCssColour("hsl(120 50% 50%)")).toBe(true);
    expect(isCssColour("hsla(120, 50%, 50%, 0.5)")).toBe(true);
    expect(isCssColour("hsl(120deg 50% 50%)")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isCssColour("  #fff  ")).toBe(true);
  });

  it("rejects non-colours and injection vectors", () => {
    expect(isCssColour("12px")).toBe(false);
    expect(isCssColour("url(x)")).toBe(false);
    expect(isCssColour("var(--x)")).toBe(false);
    expect(isCssColour("red;x")).toBe(false);
    expect(isCssColour("red")).toBe(false);
    expect(isCssColour("")).toBe(false);
    expect(isCssColour("   ")).toBe(false);
    expect(isCssColour(null)).toBe(false);
    expect(isCssColour(undefined)).toBe(false);
    expect(isCssColour("#gggggg")).toBe(false);
  });
});
