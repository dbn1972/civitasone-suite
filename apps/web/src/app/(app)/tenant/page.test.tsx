import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { findBannedTerms } from "@/lib/labels";

// The hub is a Server Component that calls getSessionRoles (next/headers) via
// ModuleHub -> visibleLinks. The tenant tiles carry no `roles`, so stub the
// session roles helper to a plain array; next/navigation is unused but mocked
// defensively.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => ["tenant_admin"] };
});

import TenantHub from "./page";

describe("GAP-TENANT-HOME-02 / HOME-04: tenant hub", () => {
  it("links to the Tenant Admin console (cross-link)", () => {
    render(<TenantHub />);
    const adminLink = screen.getByRole("link", { name: /Admin Console/i });
    expect(adminLink).toHaveAttribute("href", "/tenant-admin");
  });

  it("gives every tile a distinct icon — none falls back to the folder glyph", () => {
    const { container } = render(<TenantHub />);
    const tiles = Array.from(container.querySelectorAll("a.mtile"));
    expect(tiles.length).toBeGreaterThanOrEqual(12);
    for (const tile of tiles) {
      const ic = tile.querySelector(".ic");
      expect(ic).not.toBeNull();
      // Every chosen glyph maps to a lucide vector icon (StatIcon), so the
      // icon box renders an <svg>, never the raw ".notdef" emoji box and never
      // the generic 📁 folder-glyph fallback used when no icon is supplied.
      expect(ic!.querySelector("svg")).not.toBeNull();
      expect(ic!.textContent ?? "").not.toContain("📁");
    }
  });

  it("hub title + description contain no banned clerk-facing term", () => {
    render(<TenantHub />);
    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(findBannedTerms(heading)).toEqual([]);
    // The description sits under the header; scan the whole page-main text for
    // banned jargon ("tenant", "cross-tenant", ...).
    const main = document.querySelector(".page-main")?.textContent ?? "";
    expect(findBannedTerms(main)).toEqual([]);
  });
});
