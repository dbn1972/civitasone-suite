import { describe, it, expect } from "vitest";
import { isModuleEnabled } from "./moduleVisibility";

// GAP-JOURNEYS-HOME-03: the journeys route/nav use moduleKey "journey"; a
// tenant flag may be the plural "journeys" (or vice versa). Both must enable
// the module; an unrelated name must not.
describe("moduleVisibility — journey/journeys alias (GAP-JOURNEYS-HOME-03)", () => {
  it("enables moduleKey 'journey' when the tenant flag is 'journeys'", () => {
    expect(isModuleEnabled(["journeys"], "journey")).toBe(true);
  });

  it("enables moduleKey 'journeys' when the tenant flag is 'journey'", () => {
    expect(isModuleEnabled(["journey"], "journeys")).toBe(true);
  });

  it("enables when the flag matches the key exactly", () => {
    expect(isModuleEnabled(["journey"], "journey")).toBe(true);
    expect(isModuleEnabled(["journeys"], "journeys")).toBe(true);
  });

  it("does NOT enable 'journey' for an unrelated flag like 'journal'", () => {
    expect(isModuleEnabled(["journal"], "journey")).toBe(false);
    expect(isModuleEnabled(["journal"], "journeys")).toBe(false);
  });

  it("keeps the existing lenient matching for other modules unchanged", () => {
    // regression guard for the fallback this GAP left intact
    expect(isModuleEnabled(["hrms"], "hr")).toBe(true);
    expect(isModuleEnabled(["establishment"], "establishment")).toBe(true);
  });
});
