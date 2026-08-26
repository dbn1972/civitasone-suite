import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ReimbursementsPage from "./page";

describe("ReimbursementsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of reimbursement claims", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "r1", employee_id: "e1", category: "medical", amount_minor: 250000, bill_date: "2026-07-01", bill_ref: "BILL-1", period: "2026-07", status: "submitted" },
      ],
      source: "api",
    });

    const ui = await ReimbursementsPage();
    render(ui);

    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getByText("medical")).toBeInTheDocument();
  });

  it("renders an empty state when there are no claims", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await ReimbursementsPage();
    render(ui);

    expect(screen.getByText("No reimbursement claims yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await ReimbursementsPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
