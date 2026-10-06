import { describe, it, expect } from "vitest";
import { parseChange, trendColor, trendCue } from "./trend";

describe("parseChange (GAP-REPORTS-MIS-02)", () => {
  it("reads an explicit positive sign as up", () => {
    expect(parseChange("+5%")).toBe("up");
    expect(parseChange("+12")).toBe("up");
  });

  it("reads an explicit negative sign as down", () => {
    expect(parseChange("-3")).toBe("down");
    expect(parseChange("-3%")).toBe("down");
  });

  it("treats a Unicode minus (U+2212) as down — the core bug", () => {
    expect(parseChange("\u22124")).toBe("down"); // "−4"
    expect(parseChange("\u22124%")).toBe("down");
  });

  it("treats en/em dash prefixes as a minus too", () => {
    expect(parseChange("\u20136")).toBe("down"); // en dash "–6"
    expect(parseChange("\u20147")).toBe("down"); // em dash "—7"
  });

  it("reads an unsigned positive number as up (recorded decision)", () => {
    expect(parseChange("12%")).toBe("up");
    expect(parseChange("12")).toBe("up");
  });

  it("reads zero as flat regardless of form", () => {
    expect(parseChange("0%")).toBe("flat");
    expect(parseChange("0")).toBe("flat");
    expect(parseChange("+0")).toBe("flat");
    expect(parseChange("-0%")).toBe("flat");
  });

  it("returns unknown for null/empty/unparseable", () => {
    expect(parseChange(null)).toBe("unknown");
    expect(parseChange(undefined)).toBe("unknown");
    expect(parseChange("")).toBe("unknown");
    expect(parseChange("  ")).toBe("unknown");
    expect(parseChange("n/a")).toBe("unknown");
  });

  it("handles numeric input", () => {
    expect(parseChange(5)).toBe("up");
    expect(parseChange(-5)).toBe("down");
    expect(parseChange(0)).toBe("flat");
    expect(parseChange(Number.NaN)).toBe("unknown");
  });

  it("tolerates whitespace and thousands separators", () => {
    expect(parseChange(" +1,250 ")).toBe("up");
    expect(parseChange("\u22121,250")).toBe("down");
  });
});

describe("trendColor / trendCue", () => {
  it("maps direction to colour var", () => {
    expect(trendColor("up")).toBe("var(--good)");
    expect(trendColor("down")).toBe("var(--bad)");
    expect(trendColor("flat")).toBeUndefined();
    expect(trendColor("unknown")).toBeUndefined();
  });

  it("gives a non-colour cue for each direction", () => {
    expect(trendCue("up")).toBe("▲");
    expect(trendCue("down")).toBe("▼");
    expect(trendCue("flat")).toBe("■");
    expect(trendCue("unknown")).toBe("–");
  });
});
