import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("./AdvanceSlideOver", () => ({
  AdvanceSlideOver: () => <button type="button">+ New Advance</button>,
}));

import AdvancesPage from "./page";

const MOCK_ADVANCES = [
  {
    id: "a1",
    employee: { name: "Rajesh Kumar", employeeNo: "EMP001" },
    advanceType: "TA",
    amountMinor: 1500000,
    sanctionedBy: "Director Finance",
    recoveredMinor: 500000,
    status: "Recovery in progress",
  },
  {
    id: "a2",
    employee: { name: "Priya Singh", employeeNo: "EMP002" },
    advanceType: "Medical",
    amountMinor: 5000000,
    sanctionedBy: "Joint Secretary",
    recoveredMinor: 0,
    status: "Pending Sanction",
  },
  {
    id: "a3",
    employee: { name: "Amit Sharma", employeeNo: "EMP003" },
    advanceType: "HBA",
    amountMinor: 25000000,
    sanctionedBy: "Secretary",
    recoveredMinor: 25000000,
    status: "Closed",
  },
];

describe("AdvancesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders page title with GFR reference", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ADVANCES, source: "api" });
    render(await AdvancesPage());
    expect(screen.getByText("Advances")).toBeInTheDocument();
    expect(screen.getByText(/GFR 2017 Rule 290/)).toBeInTheDocument();
  });

  it("renders sanctioned-by column header referencing GFR R.290", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ADVANCES, source: "api" });
    render(await AdvancesPage());
    expect(screen.getByText(/Sanctioned By \(GFR R\.290\)/i)).toBeInTheDocument();
  });

  it("shows Total Advances stat card", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ADVANCES, source: "api" });
    render(await AdvancesPage());
    expect(screen.getByText("Total Advances")).toBeInTheDocument();
    expect(screen.getByText("Pending Sanction")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("displays employee data in table rows", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ADVANCES, source: "api" });
    render(await AdvancesPage());
    expect(screen.getByText(/Rajesh Kumar/)).toBeInTheDocument();
    expect(screen.getByText(/Director Finance/)).toBeInTheDocument();
  });

  it("shows empty state when no advances", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await AdvancesPage());
    expect(screen.getByText(/No advances on record/i)).toBeInTheDocument();
  });

  it("renders advance types TA and Medical in table", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ADVANCES, source: "api" });
    render(await AdvancesPage());
    expect(screen.getByText("TA")).toBeInTheDocument();
    expect(screen.getByText("Medical")).toBeInTheDocument();
  });
});
