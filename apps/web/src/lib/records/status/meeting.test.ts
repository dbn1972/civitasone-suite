import { describe, it, expect } from "vitest";
import { minutesAllowedActions, minutesAreSealed } from "./meeting";

describe("minutes status rules (maker-checker workflow)", () => {
  it("a draft can be edited and submitted, not approved", () => {
    expect([...minutesAllowedActions("draft")].sort()).toEqual(["edit", "submit"]);
  });

  it("submitted minutes can only be approved or returned", () => {
    expect([...minutesAllowedActions("submitted")].sort()).toEqual(["approve", "return"]);
  });

  it("approved, signed and circulated minutes are sealed and allow nothing", () => {
    for (const s of ["approved", "signed", "circulated"]) {
      expect(minutesAreSealed(s)).toBe(true);
      expect(minutesAllowedActions(s).size).toBe(0);
    }
    expect(minutesAreSealed("draft")).toBe(false);
  });
});
