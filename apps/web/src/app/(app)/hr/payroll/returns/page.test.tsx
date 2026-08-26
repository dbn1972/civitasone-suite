import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const statusAwareGetMock = vi.fn();
vi.mock("../_lib/statusAwareFetch", () => ({
  statusAwareGet: (...args: unknown[]) => statusAwareGetMock(...args),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ReturnsPage from "./page";

const populated26Q = {
  formType: "26Q",
  fy: "2025-26",
  quarter: "Q1",
  deducteeCount: 0,
  deductees: [],
  totalTdsDeductedMinor: "0",
  populated: false,
  reconciliation: { matched: true },
  note: "No non-salary TDS for this period. Population requires a non-salary deduction feed.",
};

describe("ReturnsPage", () => {
  beforeEach(() => {
    statusAwareGetMock.mockReset();
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: populated26Q, source: "api" });
  });

  it("renders Form-24Q deductees with money formatted via formatMoney", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: {
        formType: "24Q",
        fy: "2025-26",
        quarter: "Q1",
        deducteeCount: 1,
        deductees: [{ employeeId: "e1", pan: "ABCDE1234F", panFlag: "", name: "Asha Verma", tdsDeductedMinor: 500000, periods: ["2025-04"] }],
        reconciliation: { matched: true },
        note: "reconciled",
      },
    });

    const ui = await ReturnsPage({ searchParams: { fy: "2025-26", quarter: "Q1" } });
    render(ui);

    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    // 500000 paise == ₹5,000.00, formatted via formatMoney (not raw paise "500000")
    expect(screen.getAllByText("₹5,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("500000")).not.toBeInTheDocument();
  });

  it("shows the reconciliation-blocked affordance (with force-file option) on a 409, not a generic empty state", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "http_error",
      status: 409,
      body: { code: "TDS_RECONCILIATION_FAILED", message: "24Q blocked: TDS deducted does not match deposited challans for 2025-04." },
    });

    const ui = await ReturnsPage({ searchParams: { fy: "2025-26", quarter: "Q1" } });
    render(ui);

    expect(screen.getByText("Form-24Q blocked for FY 2025-26 Q1")).toBeInTheDocument();
    expect(screen.getByText(/does not match deposited challans/)).toBeInTheDocument();
    expect(screen.getByText("File anyway — bypass reconciliation (force)")).toBeInTheDocument();
  });

  it("shows the error affordance (not the empty-state or force-file copy) on a real failure like 403", async () => {
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 403, body: { code: "FORBIDDEN" } });

    const ui = await ReturnsPage({ searchParams: { fy: "2025-26", quarter: "Q1" } });
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
    expect(screen.getByText("Could not load Form-24Q for FY 2025-26 Q1")).toBeInTheDocument();
    expect(screen.queryByText("File anyway — bypass reconciliation (force)")).not.toBeInTheDocument();
    expect(screen.queryByText("Form-24Q blocked for FY 2025-26 Q1")).not.toBeInTheDocument();
  });

  it("shows the Form-26Q error affordance (not generic empty copy) when the loader fails", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: { formType: "24Q", fy: "2025-26", quarter: "Q1", deducteeCount: 0, deductees: [], reconciliation: { matched: true }, note: "" },
    });
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await ReturnsPage({ searchParams: { fy: "2025-26", quarter: "Q1" } });
    render(ui);

    expect(screen.getByText("Could not load Form-26Q for FY 2025-26 Q1")).toBeInTheDocument();
    expect(screen.queryByText("Non-salary TDS not yet populated")).not.toBeInTheDocument();
  });
});
