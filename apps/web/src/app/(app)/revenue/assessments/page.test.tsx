import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AssessmentsPage from "./page";

const ASSESSMENT = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  assesseeId: "11111111-1111-1111-1111-111111111111",
  rateHeadId: "22222222-2222-2222-2222-222222222222",
  financialYear: "2026-27",
  baseValue: "85000000",
  status: "active",
  version: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("AssessmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the assessments list", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSMENT], source: "api" });
    const ui = await AssessmentsPage();
    render(ui);

    expect(screen.getByText("2026-27")).toBeInTheDocument();
    expect(screen.getByText("₹8,50,000.00")).toBeInTheDocument();
  });

  it("renders an empty state when there are no assessments", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await AssessmentsPage();
    render(ui);

    expect(screen.getByText("No assessments yet")).toBeInTheDocument();
  });

  it("shows the data-source badge instead of a friendly empty state on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await AssessmentsPage();
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
    expect(screen.queryByText("No assessments yet")).not.toBeInTheDocument();
  });
});
