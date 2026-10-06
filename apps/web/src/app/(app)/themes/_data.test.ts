import { describe, it, expect } from "vitest";
import { mapRows } from "./_data";

describe("themes mapRows (GAP-THEMES-BRAND-02 / GAP-THEMES-BRANDING-01)", () => {
  it("does not repeat status in the Detail (sublabel) when there is no description", () => {
    const [row] = mapRows([{ id: "r1", name: "Preset A", status: "active", updatedAt: "2026-09-29T00:00:00.000Z" }]);
    expect(row.status).toBe("active");
    // sublabel must NOT fall back to the status value
    expect(row.sublabel).toBeUndefined();
  });

  it("formats updatedAt meta as a tenant-locale date, not a raw ISO string", () => {
    const [row] = mapRows([{ id: "r1", name: "Preset A", updatedAt: "2026-09-29T00:00:00.000Z" }]);
    expect(row.meta).toBe("29 Sep 2026");
    expect(row.meta).not.toContain("T00:00:00");
  });

  it("keeps a description as the sublabel when present", () => {
    const [row] = mapRows([{ id: "r1", name: "Preset A", description: "Default blue", status: "active" }]);
    expect(row.sublabel).toBe("Default blue");
  });
});
