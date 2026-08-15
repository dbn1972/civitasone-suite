import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import ContractualPage from "./page";

const MOCK_EMPLOYEES = [
  { id: "c1", name: "Suresh Pillai", department: "Admin", agency: "TeamLease", designation: "DEO", contractFrom: "2026-04-01", contractTo: "2027-03-31", employmentType: "contract", status: "active" },
  { id: "c2", name: "Meena Singh", department: "Finance", agency: "Quess Corp", designation: "Accountant", contractFrom: "2026-01-01", contractTo: "2026-12-31", employmentType: "contractual", status: "active" },
];

describe("ContractualPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders contractual staff from API", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await ContractualPage());
    expect(screen.getByText("Suresh Pillai")).toBeInTheDocument();
    expect(screen.getByText("Meena Singh")).toBeInTheDocument();
  });

  it("shows GFR 2017 reference in subtitle", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await ContractualPage());
    expect(screen.getByText(/GFR 2017/i)).toBeInTheDocument();
  });

  it("renders agency names", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await ContractualPage());
    expect(screen.getByText("TeamLease")).toBeInTheDocument();
  });

  it("shows Agencies stat card", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await ContractualPage());
    expect(screen.getByText("Agencies")).toBeInTheDocument();
  });

  it("renders empty state when no contractual staff", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ContractualPage());
    expect(screen.getByText(/No contractual staff/i)).toBeInTheDocument();
  });
});
