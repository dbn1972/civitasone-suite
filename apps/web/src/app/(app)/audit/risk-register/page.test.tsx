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

import RiskRegisterPage from "./page";

function risk(id: string, riskScore: number, status = "open") {
  return {
    id,
    riskCode: `R-${id}`,
    title: `Risk ${id}`,
    category: "operational",
    likelihood: "possible",
    impact: "moderate",
    riskScore,
    status,
  };
}

describe("RiskRegisterPage (GAP-AUDIT-RISK-REGISTER-02 / 06)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("band tiles (High/Medium/Low) sum to Total Risks", async () => {
    // scores: 20 -> high, 9 -> medium, 3 -> low  => total 3, high 1, med 1, low 1
    fetchJsonMock.mockResolvedValue({ data: [risk("a", 20), risk("b", 9), risk("c", 3)], source: "api" });
    render(await RiskRegisterPage());
    // Total Risks tile shows 3; each band tile shows 1.
    expect(screen.getByText("Total Risks")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    // "Low" appears as both a KPI tile label and a Segmented filter option.
    expect(screen.getAllByText("Low").length).toBeGreaterThan(0);
    // The old conflated label is gone.
    expect(screen.queryByText("Low / Controlled")).not.toBeInTheDocument();
  });

  it("shows a guided empty prompt for an empty register", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await RiskRegisterPage());
    expect(screen.getByText("No risks recorded yet")).toBeInTheDocument();
  });

  it("shows the error state and '—' tiles on a fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await RiskRegisterPage());
    expect(screen.getByText("We couldn't load risk register.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("No risks recorded yet")).not.toBeInTheDocument();
  });
});
