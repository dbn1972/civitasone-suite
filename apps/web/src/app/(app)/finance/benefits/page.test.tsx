import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import BenefitsPage from "./page";

const SAMPLE_BENEFITS = [
  {
    id: "BEN-001",
    employeeName: "Priya Nair",
    employeeCode: "EMP-201",
    benefitType: "ltc",
    status: "active",
    lastClaimedDate: "2022-12-15",
    nextEligibleDate: "2026-12-15",
    amountDisplay: "INR 45,000",
  },
  {
    id: "BEN-002",
    employeeName: "Ravi Shankar",
    employeeCode: "EMP-202",
    benefitType: "cghs",
    status: "active",
    lastClaimedDate: null,
    nextEligibleDate: null,
    amountDisplay: null,
  },
  {
    id: "BEN-003",
    employeeName: "Meera Pillai",
    employeeCode: "EMP-203",
    benefitType: "cea",
    status: "pending",
    lastClaimedDate: "2025-03-31",
    nextEligibleDate: "2026-03-31",
    amountDisplay: null,
  },
];

describe("BenefitsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders benefit type sections", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_BENEFITS, source: "api" });
    const ui = await BenefitsPage();
    render(ui);
    expect(screen.getByText("LTC")).toBeInTheDocument();
    expect(screen.getByText("CGHS")).toBeInTheDocument();
    expect(screen.getByText("CEA")).toBeInTheDocument();
  });

  it("renders employee names in their benefit group", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_BENEFITS, source: "api" });
    const ui = await BenefitsPage();
    render(ui);
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Ravi Shankar")).toBeInTheDocument();
  });

  it("shows stat cards", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_BENEFITS, source: "api" });
    const ui = await BenefitsPage();
    render(ui);
    expect(screen.getByText("Active LTC Eligibility")).toBeInTheDocument();
    expect(screen.getByText("Pending Claims")).toBeInTheDocument();
  });

  it("shows empty state when no data", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await BenefitsPage();
    render(ui);
    expect(screen.getAllByText("No records.")).toHaveLength(4);
  });

  it("shows DataSourceBadge on error source", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await BenefitsPage();
    render(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
