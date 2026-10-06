import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => mockRoles() };
});

// Keep LinkTiles light but render tile titles + hrefs so we can assert on them.
vi.mock("../../_components/LinkTiles", () => ({
  LinkTiles: ({ tiles }: { tiles: Array<{ title: string; href: string }> }) => (
    <ul>
      {tiles.map((t) => (
        <li key={t.href}>
          <a href={t.href}>{t.title}</a>
        </li>
      ))}
    </ul>
  ),
}));

import Page from "./page";

const DAILY_HREFS = [
  "/estab/inbox",
  "/estab/workspace",
  "/estab/dfa",
  "/estab/handover",
  "/estab/notifications",
];

describe("Establishment hub tiles (GAP-ESTAB-HOME-01)", () => {
  beforeEach(() => mockRoles.mockReset());

  it("exposes a My Desk tile that opens /estab/inbox", () => {
    mockRoles.mockReturnValue(["estab_officer"]);
    render(Page());
    const myDesk = screen.getByText("My Desk").closest("a");
    expect(myDesk).toHaveAttribute("href", "/estab/inbox");
  });

  it("shows every previously-untiled daily-work route", () => {
    mockRoles.mockReturnValue(["estab_officer"]);
    const { container } = render(Page());
    for (const href of DAILY_HREFS) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });
});

describe("Establishment hub admin gating (GAP-ESTAB-HOME-04)", () => {
  beforeEach(() => mockRoles.mockReset());

  it("hides Approval Matrix / Operators / Data Migration from a plain clerk", () => {
    mockRoles.mockReturnValue(["estab_officer"]);
    render(Page());
    expect(screen.queryByText("Approval Matrix")).not.toBeInTheDocument();
    expect(screen.queryByText("Operators")).not.toBeInTheDocument();
    expect(screen.queryByText("Data Migration")).not.toBeInTheDocument();
    // Daily work tiles remain visible to everyone.
    expect(screen.getByText("File Register")).toBeInTheDocument();
  });

  it("shows the administration tiles to an estab_admin", () => {
    mockRoles.mockReturnValue(["estab_admin"]);
    render(Page());
    expect(screen.getByText("Approval Matrix")).toBeInTheDocument();
    expect(screen.getByText("Operators")).toBeInTheDocument();
    expect(screen.getByText("Data Migration")).toBeInTheDocument();
  });

  it("shows Operators/Migration to a division admin but still hides Approval Matrix", () => {
    mockRoles.mockReturnValue(["estab_division_admin"]);
    render(Page());
    expect(screen.queryByText("Approval Matrix")).not.toBeInTheDocument();
    expect(screen.getByText("Operators")).toBeInTheDocument();
    expect(screen.getByText("Data Migration")).toBeInTheDocument();
  });
});
