import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import QuarterAllotmentsPage from "./page";

const ALLOTMENT = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  quarterId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  employeeRef: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  designation: "Section Officer",
  payLevel: "7",
  eligibilityScore: 71,
  appliedAt: "2026-07-01T00:00:00.000Z",
  status: "applied",
  version: 1,
};

describe("QuarterAllotmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the allotments list", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ALLOTMENT], source: "api" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    expect(screen.getByText("Section Officer")).toBeInTheDocument();
  });

  it("renders an empty state when there are no allotments", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    expect(screen.getByText("No allotment applications yet")).toBeInTheDocument();
  });

  it("shows the data-source badge instead of a friendly empty state on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
    expect(screen.queryByText("No allotment applications yet")).not.toBeInTheDocument();
  });
});
