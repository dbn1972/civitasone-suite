import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AssesseesPage from "./page";

const ASSESSEE = {
  id: "11111111-1111-1111-1111-111111111111",
  assesseeType: "property",
  identifierNo: "PROP-0001",
  ownerName: "Ramesh Kumar",
  address: "12 MG Road",
  wardNo: "4",
  zoneNo: "1",
  propertyType: "residential",
  isActive: true,
};

describe("AssesseesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the assessee list", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSEE], source: "api" });
    const ui = await AssesseesPage();
    render(ui);

    expect(screen.getByText("PROP-0001")).toBeInTheDocument();
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
  });

  it("renders the human type label, not the raw enum (ASSESSEES-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ ...ASSESSEE, assesseeType: "water_connection", identifierNo: "WAT-1" }],
      source: "api",
    });
    const ui = await AssesseesPage();
    render(ui);
    expect(screen.getAllByText("Water Connection").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("water_connection")).not.toBeInTheDocument();
  });

  it("counts a trade/other assessee under a reconciling tile (ASSESSEES-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { ...ASSESSEE, id: "a", assesseeType: "property", identifierNo: "P1" },
        { ...ASSESSEE, id: "b", assesseeType: "trade", identifierNo: "T1" },
      ],
      source: "api",
    });
    const ui = await AssesseesPage();
    render(ui);
    // Trade & Other tile exists and the trade assessee is counted there.
    expect(screen.getByText("Trade & Other")).toBeInTheDocument();
  });

  it("renders an empty state when there are no assessees", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await AssesseesPage();
    render(ui);

    expect(screen.getByText("No assessees registered")).toBeInTheDocument();
  });

  it("shows a retry error state and '—' tiles instead of a false 0 on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await AssesseesPage();
    render(ui);

    // GAP-REVENUE-ASSESSEES-01: no false "No assessees registered" all-clear and
    // no "0" stat on a failed load.
    expect(screen.queryByText("No assessees registered")).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't load assessees.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // All four stat tiles show the unknown marker, not 0.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});
