import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles(),
  hasAnyRole: (held: string[], want: string[]) => held.some((r) => want.includes(r)),
}));

// Keep LinkTiles light so we can assert tile labels + hrefs.
vi.mock("../../_components/LinkTiles", () => ({
  LinkTiles: ({ tiles }: { tiles: Array<{ title: string; href: string }> }) => (
    <ul>
      {tiles.map((t) => (
        <li key={t.title}>
          <a href={t.href}>{t.title}</a>
        </li>
      ))}
    </ul>
  ),
}));

import Page from "./page";

describe("Legal hub (GAP-LEGAL-HOME-02, GAP-LEGAL-HOME-04)", () => {
  beforeEach(() => mockRoles.mockReturnValue(["legal_officer"]));

  it("shows a New Case tile that opens /legal/cases/new", () => {
    render(Page());
    const link = screen.getByRole("link", { name: "New Case" });
    expect(link).toHaveAttribute("href", "/legal/cases/new");
  });

  it("renders a 'How this works' help affordance pointing at the legal help topic", () => {
    render(Page());
    const help = screen.getByRole("link", { name: /How this works/i });
    expect(help).toHaveAttribute("href", "/help/legal");
  });
});
