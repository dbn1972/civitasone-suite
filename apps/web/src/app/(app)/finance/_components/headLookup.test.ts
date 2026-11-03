import { describe, it, expect } from "vitest";
import { buildHeadLookup, headLabel, resolveHead } from "./headLookup";

const UUID = "1a21d796-a246-4d4a-9c2e-4da7e073f64c";
const lookup = buildHeadLookup([
  { id: UUID, code: "5100", name: "Salaries" },
  { id: "75736d77-f140-4a00-97ac-be4878934248", code: "1100", name: "Bank" },
]);

describe("head lookup (UAT Phase 1B: statements/GL show UUIDs and repeated codes)", () => {
  it("resolves a head by UUID or by code to the same code · name", () => {
    expect(headLabel(lookup, UUID)).toBe("5100 · Salaries");
    expect(headLabel(lookup, "5100")).toBe("5100 · Salaries");
    expect(resolveHead(lookup, "1100")).toEqual({ code: "1100", name: "Bank" });
  });
  it("never shows an unknown UUID raw; an unknown code is shown as the code", () => {
    expect(headLabel(lookup, "c0f46ca3-0339-422e-842f-8d0eb882b378")).toBe("Unknown head");
    expect(headLabel(lookup, "UT3CASH192")).toBe("UT3CASH192");
    expect(headLabel(lookup, null)).toBe("—");
  });
  it("does not resolve inherited object keys", () => {
    expect(resolveHead(lookup, "constructor")).toBeNull();
  });
});
