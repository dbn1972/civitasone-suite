import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import TravelPage from "./page";

const MOCK_CLAIMS = [
  {
    id: "t1",
    employee: { name: "Ravi Sharma", employeeNo: "EMP010", payLevel: 11 },
    from: "Delhi",
    to: "Bengaluru",
    departureDate: "2026-07-15",
    returnDate: "2026-07-18",
    purpose: "Technical Conference",
    fareClass: "AC-II",
    fareAmountMinor: 400000,
    daAmountMinor: 120000,
    hotelAmountMinor: 180000,
    hotelNights: 3,
    totalAmountMinor: 700000,
    auditStatus: "Under Audit",
  },
  {
    id: "t2",
    employee: { name: "Suman Rao", employeeNo: "EMP011", payLevel: 7 },
    from: "Chennai",
    to: "Hyderabad",
    departureDate: "2026-07-20",
    returnDate: "2026-07-21",
    purpose: "Inspection Visit",
    fareClass: "AC-III",
    fareAmountMinor: 120000,
    daAmountMinor: 60000,
    hotelAmountMinor: 0,
    hotelNights: 0,
    totalAmountMinor: 180000,
    auditStatus: "Approved",
  },
];

describe("TravelPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders page title with GFR Chapter 19 reference", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await TravelPage());
    expect(screen.getByText("TA / DA Claims")).toBeInTheDocument();
    expect(screen.getByText(/GFR 2017 Chapter 19/)).toBeInTheDocument();
  });

  it("renders stat cards", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await TravelPage());
    expect(screen.getByText("Total Claims")).toBeInTheDocument();
    expect(screen.getByText("Under Audit")).toBeInTheDocument();
    expect(screen.getByText("Approved / Paid")).toBeInTheDocument();
  });

  it("renders employee names in claim cards", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await TravelPage());
    expect(screen.getByText(/Ravi Sharma/)).toBeInTheDocument();
    expect(screen.getByText(/Suman Rao/)).toBeInTheDocument();
  });

  it("shows empty state when no claims", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await TravelPage());
    expect(screen.getByText(/No travel claims/i)).toBeInTheDocument();
    expect(screen.getByText(/CCS \(TA\) Rules/i)).toBeInTheDocument();
  });

  it("renders journey route for claim", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await TravelPage());
    expect(screen.getByText(/Delhi.*Bengaluru/)).toBeInTheDocument();
  });
});
