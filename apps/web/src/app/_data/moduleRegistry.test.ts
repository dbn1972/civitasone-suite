import { describe, it, expect } from "vitest";
import { hasRoleFamily } from "@/lib/auth/roleGuard";
import { MODULE_REGISTRY, MODULE_COUNT } from "@/app/_data/moduleRegistry";

describe("GAP-DASHBOARD-HOME-2-02: hasRoleFamily", () => {
  it("matches the exact family name", () => {
    expect(hasRoleFamily(["hr"], "hr")).toBe(true);
  });

  it("matches a role prefixed by family + '_'", () => {
    expect(hasRoleFamily(["hr_officer"], "hr")).toBe(true);
  });

  it("matches a role prefixed by family + ':'", () => {
    expect(hasRoleFamily(["finance:admin"], "finance")).toBe(true);
  });

  it("does NOT match a substring in the middle of a role (the old bug)", () => {
    // "chr_manager".includes("hr") was true under the old substring test.
    expect(hasRoleFamily(["chr_manager"], "hr")).toBe(false);
  });

  it("does NOT match an unrelated family", () => {
    expect(hasRoleFamily(["hr_officer"], "finance")).toBe(false);
  });

  it("returns false for empty roles", () => {
    expect(hasRoleFamily([], "hr")).toBe(false);
  });

  it("matches when any one of several roles belongs to the family", () => {
    expect(hasRoleFamily(["citizen", "hr_admin"], "hr")).toBe(true);
  });
});

describe("GAP-DASHBOARD-HOME-01 / HOME-2-03: module registry", () => {
  it("MODULE_COUNT equals the registry length", () => {
    expect(MODULE_COUNT).toBe(MODULE_REGISTRY.length);
  });

  it("includes modules that were missing from the old 17-item dashboard array", () => {
    const hrefs = new Set(MODULE_REGISTRY.map((m) => m.href));
    for (const href of ["/court", "/designer", "/visitor", "/meeting", "/inspection", "/revenue", "/billing"]) {
      expect(hrefs.has(href)).toBe(true);
    }
  });

  it("every entry has a non-empty label, href and icon", () => {
    for (const m of MODULE_REGISTRY) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.href.startsWith("/")).toBe(true);
      expect(m.icon.length).toBeGreaterThan(0);
    }
  });
});
