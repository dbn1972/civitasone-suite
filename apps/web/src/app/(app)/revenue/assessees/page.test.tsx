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

function pageOf(rows: unknown[], total = rows.length, summary: Record<string, number> | null = null) {
  return { rows, total, summary };
}

describe("AssesseesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the assessee list", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf([ASSESSEE]), source: "api" });
    const ui = await AssesseesPage();
    render(ui);

    expect(screen.getByText("PROP-0001")).toBeInTheDocument();
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
  });

  it("renders the human type label, not the raw enum (ASSESSEES-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: pageOf([{ ...ASSESSEE, assesseeType: "water_connection", identifierNo: "WAT-1" }]),
      source: "api",
    });
    const ui = await AssesseesPage();
    render(ui);
    expect(screen.getAllByText("Water Connection").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("water_connection")).not.toBeInTheDocument();
  });

  it("counts a trade/other assessee under a reconciling tile (ASSESSEES-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: pageOf([
        { ...ASSESSEE, id: "a", assesseeType: "property", identifierNo: "P1" },
        { ...ASSESSEE, id: "b", assesseeType: "trade", identifierNo: "T1" },
      ]),
      source: "api",
    });
    const ui = await AssesseesPage();
    render(ui);
    // Trade & Other tile exists and the trade assessee is counted there.
    expect(screen.getByText("Trade & Other")).toBeInTheDocument();
  });

  it("renders an empty state when there are no assessees", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf([]), source: "api" });
    const ui = await AssesseesPage();
    render(ui);

    expect(screen.getByText("No assessees registered")).toBeInTheDocument();
  });

  it("shows a retry error state and '—' tiles instead of a false 0 on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf([]), source: "error" });
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

  // GAP-REVENUE-ASSESSEES-04
  it("requests a server page with the search term and offset", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf([ASSESSEE], 40), source: "api" });
    await AssesseesPage({ searchParams: Promise.resolve({ q: "Ramesh", page: "2" }) });
    const url = fetchJsonMock.mock.calls[0]![0] as string;
    expect(url).toContain("limit=15");
    expect(url).toContain("offset=15");
    expect(url).toContain("q=Ramesh");
  });

  it("shows the server total and Previous/Next links beyond one page", async () => {
    fetchJsonMock.mockResolvedValue({
      data: pageOf([ASSESSEE], 40, { total: 250, property: 200, waterConnection: 30, other: 20, active: 240 }),
      source: "api",
    });
    const ui = await AssesseesPage({ searchParams: Promise.resolve({ page: "2" }) });
    render(ui);
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/revenue/assessees");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/revenue/assessees?page=3");
    // tenant-wide tile from the server summary, not the page length
    expect(screen.getByText("250")).toBeInTheDocument();
  });

  it("shows a no-match state (not the empty-register copy) for a search with no hits", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf([]), source: "api" });
    const ui = await AssesseesPage({ searchParams: Promise.resolve({ q: "zzz" }) });
    render(ui);
    expect(screen.getByText("No assessees match your search")).toBeInTheDocument();
    expect(screen.queryByText("No assessees registered")).not.toBeInTheDocument();
  });
});
