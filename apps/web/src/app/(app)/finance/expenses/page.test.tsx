import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ExpensesPage from "./page";

const SAMPLE_CLAIMS = [
  {
    id: "EXP-001",
    employeeName: "Rakesh Kumar",
    employeeCode: "EMP-101",
    category: "office_supplies",
    description: "Stationery for Q1",
    amount: 2500,
    currency: "INR",
    receiptAttached: true,
    ddoCountersigned: false,
    status: "pending",
    submittedDate: "2026-08-01",
  },
  {
    id: "EXP-002",
    employeeName: "Sunita Devi",
    employeeCode: "EMP-102",
    category: "communication",
    description: "Mobile recharge for field duty",
    amount: 500,
    currency: "INR",
    receiptAttached: true,
    ddoCountersigned: true,
    status: "approved",
    submittedDate: "2026-07-15",
  },
];

describe("ExpensesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the expense claims list", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_CLAIMS, source: "api" });
    const ui = await ExpensesPage();
    render(ui);
    expect(screen.getByText("Rakesh Kumar")).toBeInTheDocument();
    expect(screen.getByText("Sunita Devi")).toBeInTheDocument();
  });

  it("shows correct stat cards", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_CLAIMS, source: "api" });
    const ui = await ExpensesPage();
    render(ui);
    expect(screen.getByText("Total Claims")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Awaiting DDO")).toBeInTheDocument();
  });

  it("shows empty state when no claims", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await ExpensesPage();
    render(ui);
    expect(screen.getByText("No expense claims found.")).toBeInTheDocument();
  });

  it("shows DataSourceBadge on error source", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await ExpensesPage();
    render(ui);
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
