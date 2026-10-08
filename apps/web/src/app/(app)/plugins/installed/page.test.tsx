/**
 * GAP2-PLUGINS-INSTALLED-05 (LOW) — the four summary StatCards passed raw
 * light-only hex `iconBg` values (#eff8ff / #e6f7f0 / #f4f5f7 / #fff6e6)
 * rather than DS tone tokens, so in dark mode the icon chips kept a near-white
 * background.
 *
 * FIXED: each StatCard now uses the DS `tone` prop (info/good/neutral/warn),
 * which maps to theme-token backgrounds that follow the active theme. This
 * guard asserts the page passes no hex `iconBg` literal — fails on old code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("plugins/installed page — StatCard tone tokens, no hex iconBg", () => {
  const src = readFileSync(join(__dirname, "page.tsx"), "utf8");

  it("passes no hex-literal iconBg to StatCard", () => {
    expect(src).not.toMatch(/iconBg=["']#[0-9a-fA-F]{3,6}/);
  });

  it("uses the DS tone prop on the summary StatCards", () => {
    expect(src).toMatch(/tone="info"/);
    expect(src).toMatch(/tone="good"/);
    expect(src).toMatch(/tone="neutral"/);
    expect(src).toMatch(/tone="warn"/);
  });
});
