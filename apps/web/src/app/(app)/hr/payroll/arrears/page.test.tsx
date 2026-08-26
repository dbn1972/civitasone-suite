import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ArrearsPage from "./page";

// Fixtures use the REAL wire shape returned by GET /v1/payroll/arrears --
// i.e. the literal `payroll.payroll_arrears` columns (`SELECT *`), confirmed
// against services/payroll-service/src/modules/payroll/repo.ts (listArrears)
// and migrations/0035_world_class_payroll.sql. Before the fix, the page read
// `employee`/`department`/`arrearType`/`period`/`amount`/`payableMonth` --
// none of which the API has ever sent -- so every real row rendered blank.
describe("ArrearsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("maps real backend-shaped rows onto the table instead of rendering blanks", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "a1",
          employee_id: "e-101",
          run_id: null,
          component_code: "DA_ARREAR",
          from_period: "2025-04",
          to_period: "2025-07",
          old_amount_minor: 4500000,
          new_amount_minor: 5000000,
          difference_minor: 500000,
          reason: "DA revision Jan 2025",
          status: "pending",
          source: "revision",
          created_at: "2025-08-01T00:00:00Z",
        },
        {
          id: "a2",
          employee_id: "e-102",
          run_id: "r-9",
          component_code: "PROMOTION_ARREAR",
          from_period: "2025-01",
          to_period: "2025-03",
          old_amount_minor: 6000000,
          new_amount_minor: 6800000,
          difference_minor: 800000,
          reason: "Promotion w.e.f. Jan 2025",
          status: "paid",
          source: "manual",
          created_at: "2025-05-01T00:00:00Z",
        },
        {
          id: "a3",
          employee_id: "e-103",
          run_id: "r-9",
          component_code: "PAY_FIXATION_ARREAR",
          from_period: "2024-07",
          to_period: "2024-12",
          old_amount_minor: 5200000,
          new_amount_minor: 5900000,
          difference_minor: 700000,
          reason: "7th CPC fixation",
          status: "paid",
          source: "manual",
          created_at: "2025-05-01T00:00:00Z",
        },
      ],
      source: "api",
    });

    const ui = await ArrearsPage();
    render(ui);

    // Employee (was `.employee`, a field the API never sent).
    expect(screen.getByText("e-101")).toBeInTheDocument();
    expect(screen.getByText("e-102")).toBeInTheDocument();
    expect(screen.getByText("e-103")).toBeInTheDocument();

    // Arrear Type (was `.arrearType`; real field is `component_code`).
    expect(screen.getByText("DA_ARREAR")).toBeInTheDocument();

    // From/To Period (was a single non-existent `.period`; the API actually
    // sends two separate period fields).
    expect(screen.getByText("2025-04")).toBeInTheDocument();
    expect(screen.getByText("2025-07")).toBeInTheDocument();

    // Reason (a real field the old page didn't surface at all).
    expect(screen.getByText("DA revision Jan 2025")).toBeInTheDocument();

    // Amount (was `.amount` with no cellType; real field is `difference_minor`,
    // rendered minor-unit-safe via the table's `cellType: "amount"` -> formatMoney).
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹8,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹7,000.00")).toBeInTheDocument();

    // Stat cards: Total / Pending / Approved-or-Paid / money total. Also guards
    // the pre-existing "Processed" stat bug, which compared status to the
    // non-existent value "processed" -- the real CHECK constraint only allows
    // pending/approved/paid/rejected, so that counter always undercounted.
    expect(screen.getByText("3")).toBeInTheDocument(); // Total
    expect(screen.getByText("1")).toBeInTheDocument(); // Pending (a1 only)
    expect(screen.getByText("2")).toBeInTheDocument(); // Approved/Paid (a2 + a3)
    expect(screen.getByText("₹20,000.00")).toBeInTheDocument(); // Total Arrears Amount (500000+800000+700000 paise)
  });

  it("renders an empty state when there are no arrears", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await ArrearsPage();
    render(ui);

    expect(screen.getByText("No arrears computed")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await ArrearsPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
