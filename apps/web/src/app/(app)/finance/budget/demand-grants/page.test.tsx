import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getGrants = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceDemandGrants: () => getGrants() }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import DemandGrantsPage from "./page";

const grant = (id: string, cls: string) => ({
  id, demandNo: `D-${id}`, service: `Svc ${id}`, amountMinor: "100", currency: "INR", class: cls, status: "draft",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1,
});

describe("DemandGrantsPage", () => {
  beforeEach(() => getGrants.mockReset());

  // GAP-FINANCE-BUDGET-DEMAND-GRANTS-02
  it("uses neutral (Union-or-State) copy, not 'Parliamentary'", async () => {
    getGrants.mockResolvedValue({ data: [], source: "api" });
    render(await DemandGrantsPage());
    expect(screen.getByText("Demands for grants with voted/charged breakup.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Parliament/);
  });

  // GAP-FINANCE-BUDGET-DEMAND-GRANTS-03
  it("voted 1 + charged 1 + unknown class 1 -> an Other card of 1, and Total = 3", async () => {
    getGrants.mockResolvedValue({ data: [grant("a", "voted"), grant("b", "charged"), grant("c", "x")], source: "api" });
    render(await DemandGrantsPage());
    const card = (label: string) => screen.getAllByText(label).find((e) => !e.closest("table"))!.parentElement!.textContent;
    expect(card("Other")).toContain("1");
    expect(card("Voted")).toContain("1");
    expect(card("Charged")).toContain("1");
    expect(card("Total Demands")).toContain("3");
  });

  it("shows no Other card when every class is voted/charged", async () => {
    getGrants.mockResolvedValue({ data: [grant("a", "voted"), grant("b", "charged")], source: "api" });
    render(await DemandGrantsPage());
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("Class column reads 'Voted', not the raw lowercase value", async () => {
    getGrants.mockResolvedValue({ data: [grant("a", "voted")], source: "api" });
    render(await DemandGrantsPage());
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("Voted");
    expect(cells).not.toContain("voted");
  });
});
