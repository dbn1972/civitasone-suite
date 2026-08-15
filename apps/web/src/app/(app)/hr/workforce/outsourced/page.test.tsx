import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import OutsourcedPage from "./page";

const MOCK_EMPLOYEES = [
  { id: "o1", agency: "SecureGuard Ltd", department: "Security", service: "Security Services", deploymentLocation: "HQ Block A", headcount: 12, contractEnd: "2027-03-31", employmentType: "outsourced", status: "active" },
  { id: "o2", agency: "CleanServ", department: "Facilities", service: "Housekeeping", deploymentLocation: "Annexe Building", headcount: 8, contractEnd: "2026-12-31", employmentType: "vendor", status: "active" },
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
    expect(screen.getByText("Vendors")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders empty state for no outsourced staff", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await OutsourcedPage());
    expect(screen.getByText(/No outsourced staff records/i)).toBeInTheDocument();
  });
});
