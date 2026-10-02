import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinancePageSkeleton } from "./FinancePageSkeleton";
import OpeningBalancesLoading from "../opening-balances/loading";
import PeriodCloseLoading from "../period-close/loading";
import PaymentDetailLoading from "../payments/[id]/loading";

describe("finance loading skeletons (GAP-FINANCE-OPENING-BALANCES-07 / PERIOD-CLOSE-07 / PAYMENTS-DETAIL-05)", () => {
  it("renders the requested number of stat placeholders and card blocks in one status region", () => {
    const { container } = render(<FinancePageSkeleton stats={3} blocks={[100, 200]} label="Loading x" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading x");
    expect(screen.getByTestId("skeleton-stats").children).toHaveLength(3);
    // 3 stat cards (no .skeleton bars inside) + header bars (2) + 2 card blocks
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3 + 2 + 2);
  });

  it("opening balances: three stat placeholders, one status region", () => {
    render(<OpeningBalancesLoading />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByTestId("skeleton-stats").children).toHaveLength(3);
  });

  it("period close: four stat placeholders, one status region", () => {
    render(<PeriodCloseLoading />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByTestId("skeleton-stats").children).toHaveLength(4);
  });

  it("payment detail: a single status region with four stat blocks", () => {
    render(<PaymentDetailLoading />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
