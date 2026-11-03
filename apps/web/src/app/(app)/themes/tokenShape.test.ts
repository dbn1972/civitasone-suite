import { describe, it, expect } from "vitest";
import { normaliseThemeTokens } from "./tokenShape";
import { contrastPairs } from "./ThemeContrastPanel";

describe("normaliseThemeTokens (UAT Phase 1B: /themes/tokens render crash)", () => {
  it("maps theme-service's `name` onto `key` (the real GET /v1/themes/tokens row shape)", () => {
    const rows = [{ id: "t1", tenantId: "x", name: "brand.primary", value: "#123456", category: "color", status: "active", version: 1 }];
    expect(normaliseThemeTokens(rows)).toEqual([expect.objectContaining({ key: "brand.primary", value: "#123456" })]);
  });
  it("keeps an explicit `key` and drops rows with no identifier", () => {
    expect(normaliseThemeTokens([{ key: "surface.canvas", value: "#fff" }, { value: "#000" }, null])).toEqual([
      expect.objectContaining({ key: "surface.canvas", value: "#fff" }),
    ]);
  });
  it("feeds contrastPairs without throwing", () => {
    const tokens = normaliseThemeTokens([
      { name: "surface.canvas", value: "#ffffff" },
      { name: "brand.primary", value: "#123456" },
    ]);
    expect(contrastPairs(tokens).map((p) => p.label)).toEqual(["Primary on background"]);
  });
});
