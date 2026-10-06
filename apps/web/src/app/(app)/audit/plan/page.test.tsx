import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import AuditPlanPage from "./page";

describe("AuditPlanPage (GAP-AUDIT-PLAN-02 / PLAN-06)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("drops the hard-coded 'FY26' delta and the fabricated 'coverage'/up badge", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await AuditPlanPage());
    expect(screen.queryByText("FY26")).not.toBeInTheDocument();
    expect(screen.queryByText("coverage")).not.toBeInTheDocument();
    // Tile is now honestly labelled.
    expect(screen.getByText("Non-routine share")).toBeInTheDocument();
  });

  it("shows a guided empty prompt (not bare headers) for a tenant with no plans", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await AuditPlanPage());
    expect(screen.getByText("No audits planned yet")).toBeInTheDocument();
  });

  it("shows the error state and '—' KPIs on a fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await AuditPlanPage());
    expect(screen.getByText("We couldn't load audit plan.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("No audits planned yet")).not.toBeInTheDocument();
  });
});
