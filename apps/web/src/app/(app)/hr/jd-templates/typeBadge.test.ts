import { describe, it, expect } from "vitest";
import { typeBadge } from "./typeBadge";

describe("typeBadge (GAP-HR-JD-TEMPLATES-06)", () => {
  it("maps every known vacancy type to its filter label key and colour tokens", () => {
    const types = ["regular", "internship", "apprenticeship", "volunteership", "contractual", "deputation"];
    for (const type of types) {
      const badge = typeBadge(type);
      expect(badge, type).not.toBeNull();
      expect(badge!.labelKey).toMatch(/^filter[A-Z]/);
      expect(badge!.color).toMatch(/^var\(--/);
      expect(badge!.bg).toMatch(/^var\(--/);
    }
    expect(typeBadge("volunteership")!.labelKey).toBe("filterVolunteer");
  });

  it("returns null for an unknown type so the page can show the raw value", () => {
    expect(typeBadge("something-new")).toBeNull();
    expect(typeBadge("")).toBeNull();
  });
});
