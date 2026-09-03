import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import OutsourcedPage from "./page";

// Row-shaped fixtures: fetchJson is mocked wholesale (bypassing the real mapOutsourced()
// transform in page.tsx), so these must already look like the post-map Row type — with
// `vendor` (not the raw `agency` field) and no employmentType/type.
const MOCK_EMPLOYEES = [
  { id: "o1", vendor: "SecureGuard Ltd", department: "Security", service: "Security Services", deploymentLocation: "HQ Block A", headcount: "12", contractEnd: "2027-03-31", status: "active" },
  { id: "o2", vendor: "CleanServ", department: "Facilities", service: "Housekeeping", deploymentLocation: "Annexe Building", headcount: "8", contractEnd: "2026-12-31", status: "active" },
];

describe("OutsourcedPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders outsourced vendor names", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await OutsourcedPage());
    expect(screen.getByText("SecureGuard Ltd")).toBeInTheDocument();
    expect(screen.getByText("CleanServ")).toBeInTheDocument();
  });

  it("shows GFR 2017 reference in subtitle", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await OutsourcedPage());
    expect(screen.getByText(/GFR 2017/i)).toBeInTheDocument();
  });

  it("renders headcount stat", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await OutsourcedPage());
    expect(screen.getByText("Total Headcount")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("renders vendors stat count", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await OutsourcedPage());
    // Both fixture rows are active vendors, so "Active Contracts" and
    // "Total Records" also read "2" — scope the assertion to the Vendors
    // stat card specifically rather than a bare getByText("2").
    const vendorsLabel = screen.getByText("Vendors");
    const vendorsCard = vendorsLabel.closest(".stat");
    expect(vendorsCard).not.toBeNull();
    expect(vendorsCard!.querySelector(".val")).toHaveTextContent("2");
  });

  it("renders empty state for no outsourced staff", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await OutsourcedPage());
    expect(screen.getByText(/No outsourced staff records/i)).toBeInTheDocument();
  });
});
