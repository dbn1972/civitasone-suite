import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FlexBenefitsPage from "./page";

describe("FlexBenefitsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of elections", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "el1", plan_id: "p1", plan_name: "FY26 Flex Plan", fy: "2025-26", total_elected_minor: 500000, status: "submitted" },
      ],
      source: "api",
    });

    const ui = await FlexBenefitsPage();
    render(ui);

    expect(screen.getByText("FY26 Flex Plan")).toBeInTheDocument();
  });

  it("renders an empty state when there are no elections", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await FlexBenefitsPage();
    render(ui);

    expect(screen.getByText("No flex benefit elections yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await FlexBenefitsPage();
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
