import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["works_admin"],
}));

import WorksHub from "./page";

describe("WorksHub — navigation integrity (L1)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({
      data: { totalWorks: 3, activeWorks: 2, closedWorks: 1, byStatus: { draft: 1 } },
      source: "api",
    });
  });

  it("points the Procurement tile at the real /procurement module, not the dead /works/procurement", async () => {
    const ui = await WorksHub();
    const { container } = render(ui);

    const procurement = screen.getByRole("link", { name: /Procurement/i });
    expect(procurement).toHaveAttribute("href", "/procurement");

    // No hub tile should link to the non-existent /works/procurement route.
    expect(container.querySelector('a[href="/works/procurement"]')).toBeNull();
  });

  it("renders the module tiles with the live dashboard KPIs", async () => {
    const ui = await WorksHub();
    render(ui);
    expect(screen.getByRole("link", { name: /Work Proposals/i })).toHaveAttribute("href", "/works/proposals");
    expect(screen.getByText("Total Works")).toBeInTheDocument();
  });
});
