import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PayGroupsPage from "./page";

describe("PayGroupsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of pay groups", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "g1", name: "Monthly Staff", frequency: "monthly", pay_day_of_month: 28, timezone: "Asia/Kolkata", status: "active" },
      ],
      source: "api",
    });

    const ui = await PayGroupsPage();
    render(ui);

    expect(screen.getByText("Monthly Staff")).toBeInTheDocument();
  });

  it("renders an empty state when there are no pay groups", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PayGroupsPage();
    render(ui);

    expect(screen.getByText("No pay groups yet")).toBeInTheDocument();
  });
});
