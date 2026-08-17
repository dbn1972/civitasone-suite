import { describe, it, expect } from "vitest";
import { contrast } from "../contrast";

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
