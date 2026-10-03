import { describe, it, expect } from "vitest";
import { availableLifecycleActions } from "./lifecycleUi";

describe("availableLifecycleActions (GAP-FINANCE-TREASURY-CHEQUES-03)", () => {
  it("offers present, clear and bounce from issued", () => {
    expect(availableLifecycleActions("issued")).toEqual(["present", "clear", "bounce"]);
  });
  it("offers clear and bounce (not present) once presented", () => {
    expect(availableLifecycleActions("presented")).toEqual(["clear", "bounce"]);
  });
  it("offers nothing from a terminal or unknown state, and tolerates case/space/null", () => {
    for (const s of ["cleared", "bounced", "cancelled", "stale", "", null, undefined]) expect(availableLifecycleActions(s)).toEqual([]);
    expect(availableLifecycleActions(" Issued ")).toEqual(["present", "clear", "bounce"]);
  });
});
