import { describe, it, expect } from "vitest";
import { isModuleEnabled } from "./moduleVisibility";

describe("module visibility gating (R13.1, R13.2, R13.4)", () => {
  it("always shows modules with a null key (platform/overview)", () => {
    expect(isModuleEnabled([], null)).toBe(true);
    expect(isModuleEnabled(["finance"], null)).toBe(true);
  });

  it("shows all when enablement is unknown (null list)", () => {
    expect(isModuleEnabled(null, "finance")).toBe(true);
  });

  it("hides a disabled module", () => {
    expect(isModuleEnabled(["finance", "hrms"], "procurement")).toBe(false);
  });

  it("shows an enabled module, matching leniently across naming", () => {
    expect(isModuleEnabled(["finance"], "finance")).toBe(true);
    expect(isModuleEnabled(["hrms"], "hr")).toBe(true);
    expect(isModuleEnabled(["establishment"], "establishment")).toBe(true);
  });
});
