import { describe, it, expect } from "vitest";
import { collapseGlossary, explain, GLOSSARY_ALIASES } from "./glossary";

describe("collapseGlossary (GAP-HELP-HOME-02)", () => {
  it("folds each alias into one canonical row with the alias attached", () => {
    const rows = collapseGlossary();
    const hoa = rows.find((r) => r.term === "Head of Account");
    expect(hoa).toBeDefined();
    expect(hoa!.alias).toBe("HoA");
    // The alias key no longer appears as its own row.
    expect(rows.find((r) => r.term === "HoA")).toBeUndefined();
  });

  it("drops every alias row and keeps every canonical row", () => {
    const rows = collapseGlossary();
    for (const alias of Object.keys(GLOSSARY_ALIASES)) {
      expect(rows.find((r) => r.term === alias)).toBeUndefined();
    }
    for (const canonical of Object.values(GLOSSARY_ALIASES)) {
      expect(rows.find((r) => r.term === canonical)).toBeDefined();
    }
  });

  it("is sorted by term", () => {
    const rows = collapseGlossary();
    const sorted = [...rows].sort((a, b) => a.term.localeCompare(b.term));
    expect(rows.map((r) => r.term)).toEqual(sorted.map((r) => r.term));
  });

  it("leaves the shared tooltip lookups unchanged (both spellings still resolve)", () => {
    // explain() must keep resolving the alias AND the canonical spelling, so
    // the on-screen "?" tooltips are unaffected.
    expect(explain("HoA")).toBeTruthy();
    expect(explain("Head of Account")).toBeTruthy();
    expect(explain("UC")).toBeTruthy();
    expect(explain("Utilisation Certificate")).toBeTruthy();
  });
});
