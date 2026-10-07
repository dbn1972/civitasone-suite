import { describe, it, expect } from "vitest";
import { contrast, contrastRatio, readableForeground } from "../contrast";

describe("contrast (WCAG 2.x relative-luminance contrast ratio)", () => {
  it("contrast('#C55200', '#FFFFFF') meets WCAG AA (>= 4.5:1) for normal text", () => {
    const ratio = contrast("#C55200", "#FFFFFF");
    expect(
      ratio,
      `#C55200 on white is ${ratio.toFixed(2)}:1; WCAG 2.2 AA SC 1.4.3 requires >= 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("the app's actual warning token (--warn on --warnbg) meets WCAG AA", () => {
    // civitas-ds.css: --warn:#b54708; --warnbg:#fffaeb — used by .pill.warn,
    // the file-status badge class this requirement is about. Confirms the
    // live design token already clears AA (no live violation to fix).
    const ratio = contrast("#b54708", "#fffaeb");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("identical colours have a contrast ratio of 1:1", () => {
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("black on white has the maximum contrast ratio of 21:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is symmetric regardless of argument order", () => {
    const a = contrast("#C55200", "#FFFFFF");
    const b = contrast("#FFFFFF", "#C55200");
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("contrastRatio (GAP-SETTINGS-BRANDING-06 acceptance)", () => {
  it("contrastRatio('#000000','#ffffff') = 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("contrastRatio('#777777','#ffffff') < 4.5 (fails AA)", () => {
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("Text #cccccc on white #ffffff is below the AA threshold", () => {
    expect(contrastRatio("#cccccc", "#ffffff")).toBeLessThan(4.5);
  });
});

describe("readableForeground (GAP-SETTINGS-BRANDING-01)", () => {
  it("a light primary (#fde68a amber) yields near-black #111827", () => {
    expect(readableForeground("#fde68a")).toBe("#111827");
  });

  it("a dark primary (#1e40af blue) yields white #ffffff", () => {
    expect(readableForeground("#1e40af")).toBe("#ffffff");
  });

  it("the derived foreground clears WCAG AA against the chosen background", () => {
    for (const bg of ["#fde68a", "#1e40af", "#f59e0b", "#16a34a", "#ffffff", "#000000"]) {
      expect(contrastRatio(readableForeground(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("falls back to near-black for malformed hex rather than throwing", () => {
    expect(readableForeground("#zzz")).toBe("#111827");
    expect(readableForeground("not-a-color")).toBe("#111827");
  });

  it("supports 3-digit shorthand hex", () => {
    expect(readableForeground("#fff")).toBe("#111827");
    expect(readableForeground("#000")).toBe("#ffffff");
  });
});
