import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { RateConfigConsole } from "./RateConfigConsole";
import type { RateHeadRow, RateSlabRow, PenaltyRuleRow, RebateRuleRow } from "./types";

const rateHead: RateHeadRow = {
  id: "rh1",
  code: "PT",
  name: "Property Tax",
  category: "property_tax",
  unitOfMeasure: "sq_ft",
  isActive: true,
};

const slab: RateSlabRow = {
  id: "s1",
  rateHeadId: "rh1",
  slabType: "ad_valorem",
  bandFrom: null,
  bandTo: null,
  rateValue: "1200",
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  isActive: true,
};

const penalty: PenaltyRuleRow = {
  id: "p1",
  rateHeadId: "rh1",
  interestType: "simple",
  annualRateBps: 1200,
  graceDays: 15,
  capMonths: 12,
  roundingMode: "round_half_up",
  isActive: true,
};

const rebate: RebateRuleRow = {
  id: "r1",
  rateHeadId: "rh1",
  rebateType: "early_payment",
  discountBps: 500,
  validUntilDaysBeforeDue: 30,
  isActive: true,
};

function baseProps() {
  return {
    rateHeads: [rateHead],
    rateHeadsSource: "api" as const,
    selectedRateHeadId: "rh1",
    slabs: [] as RateSlabRow[],
    slabsSource: "api" as const,
    penaltyRules: [] as PenaltyRuleRow[],
    penaltyRulesSource: "api" as const,
    rebateRules: [] as RebateRuleRow[],
    rebateRulesSource: "api" as const,
  };
}

describe("RateConfigConsole", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the rate heads list on the default tab", () => {
    render(<RateConfigConsole {...baseProps()} />);
    expect(screen.getByText("PT")).toBeInTheDocument();
    expect(screen.getByText("Property Tax")).toBeInTheDocument();
  });

  it("renders an empty state (not the error badge) when rate heads are genuinely empty", () => {
    render(<RateConfigConsole {...baseProps()} rateHeads={[]} selectedRateHeadId={null} />);
    expect(screen.getByText("No rate heads configured")).toBeInTheDocument();
    expect(screen.queryByText("Showing saved information")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge (not an empty state) when rate heads source is 'error'", () => {
    render(<RateConfigConsole {...baseProps()} rateHeads={[]} rateHeadsSource="error" selectedRateHeadId={null} />);
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
    expect(screen.queryByText("No rate heads configured")).not.toBeInTheDocument();
  });

  it("renders rate slabs with percent formatting for ad_valorem and money for flat/band", () => {
    render(<RateConfigConsole {...baseProps()} slabs={[slab]} />);
    fireEvent.click(screen.getByText("Rate Slabs"));
    expect(screen.getByText("12%")).toBeInTheDocument();
  });

  it("renders an empty state for rate slabs when genuinely empty", () => {
    render(<RateConfigConsole {...baseProps()} />);
    fireEvent.click(screen.getByText("Rate Slabs"));
    expect(screen.getByText("No rate slabs for this rate head")).toBeInTheDocument();
  });

  it("renders the saved-information badge for rate slabs on source 'error'", () => {
    render(<RateConfigConsole {...baseProps()} slabsSource="error" />);
    fireEvent.click(screen.getByText("Rate Slabs"));
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });

  it("renders penalty rules with the annual rate formatted as a percent", () => {
    render(<RateConfigConsole {...baseProps()} penaltyRules={[penalty]} />);
    fireEvent.click(screen.getByText("Penalty Rules"));
    expect(screen.getByText("12%")).toBeInTheDocument();
  });

  it("renders the saved-information badge for penalty rules on source 'error'", () => {
    render(<RateConfigConsole {...baseProps()} penaltyRulesSource="error" />);
    fireEvent.click(screen.getByText("Penalty Rules"));
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });

  it("renders rebate rules with the discount formatted as a percent", () => {
    render(<RateConfigConsole {...baseProps()} rebateRules={[rebate]} />);
    fireEvent.click(screen.getByText("Rebate Rules"));
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("renders the saved-information badge for rebate rules on source 'error'", () => {
    render(<RateConfigConsole {...baseProps()} rebateRulesSource="error" />);
    fireEvent.click(screen.getByText("Rebate Rules"));
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });

  it("prompts to select a rate head on scoped tabs when none is selected", () => {
    render(<RateConfigConsole {...baseProps()} rateHeads={[]} selectedRateHeadId={null} />);
    fireEvent.click(screen.getByText("Rate Slabs"));
    expect(screen.getByText("Select a rate head")).toBeInTheDocument();
  });
});
