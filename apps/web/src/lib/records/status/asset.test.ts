import { describe, it, expect } from "vitest";
import { assetCanRaiseDisposal, assetIsFinished, assetRaiseBlockedReason } from "./asset";

describe("asset status rules (mirror lib/assetLifecycle and asset-service)", () => {
  it("only an in-service asset may raise a disposal", () => {
    for (const s of ["active", "in_use", "maintenance"]) expect(assetCanRaiseDisposal(s)).toBe(true);
    for (const s of ["disposed", "written_off", "scrapped", "condemned", "lost"]) expect(assetCanRaiseDisposal(s)).toBe(false);
  });

  it("disposed / written off / scrapped are finished", () => {
    expect(assetIsFinished("disposed")).toBe(true);
    expect(assetIsFinished("written_off")).toBe(true);
    expect(assetIsFinished("condemned")).toBe(false);
  });

  it("explains why the disposal route is closed", () => {
    expect(assetRaiseBlockedReason("condemned")).toMatch(/condemnation workflow/);
    expect(assetRaiseBlockedReason("disposed")).toMatch(/disposed/);
    expect(assetRaiseBlockedReason("active")).toBeNull();
  });
});
