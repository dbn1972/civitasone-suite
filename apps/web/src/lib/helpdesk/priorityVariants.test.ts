import { describe, it, expect } from "vitest";
import { HELPDESK_PRIORITY_VARIANTS, helpdeskPriorityVariant } from "./priorityVariants";

describe("helpdesk priority tones (module-local, not in shared STATUS_MAP)", () => {
  it.each([["low", "info"], ["Medium", "warn"], ["HIGH", "warn"], ["critical", "bad"]])("%s -> %s", (p, tone) => {
    expect(HELPDESK_PRIORITY_VARIANTS[p]).toBe(tone);
    expect(helpdeskPriorityVariant(p)).toBe(tone);
  });
  it("unknown or empty priority falls back to the shared map", () => {
    expect(helpdeskPriorityVariant("whatever")).toBeUndefined();
    expect(helpdeskPriorityVariant(null)).toBeUndefined();
  });
});
