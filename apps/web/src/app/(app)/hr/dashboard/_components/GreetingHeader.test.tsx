import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GreetingHeader } from "./GreetingHeader";

// Distinct, non-colliding real values, same convention as HRKPIStrip.test.tsx.
const baseProps = {
  userName: "Asha",
  pendingCount: 3,
  payrollDaysLeft: 12,
  today: "23 September 2026",
  dayName: "Wednesday",
};

function getGreeting(): HTMLElement {
  return screen.getByTestId("dashboard-greeting");
}

describe("GreetingHeader", () => {
  it("shows the pending-count briefing when there are pending items", () => {
    render(<GreetingHeader {...baseProps} />);
    expect(within(getGreeting()).getByText(/3 items need your attention/)).toBeInTheDocument();
  });

  it("uses correct singular grammar for exactly one pending item", () => {
    render(<GreetingHeader {...baseProps} pendingCount={1} />);
    expect(within(getGreeting()).getByText(/1 item needs your attention/)).toBeInTheDocument();
  });

  it("falls back to the payroll briefing when nothing is pending and payroll closes soon", () => {
    render(<GreetingHeader {...baseProps} pendingCount={0} payrollDaysLeft={5} />);
    expect(within(getGreeting()).getByText(/Payroll closes in 5 days/)).toBeInTheDocument();
  });

  describe("fabricated zero vs honest — (absent data)", () => {
    // Same bug class as HRKPIStrip.tsx / StatCard.tsx: a failed dashboard
    // load's fabricated 0 must not render as the real all-clear ("No urgent
    // actions today"). pendingCount is sourced from the same
    // data.pendingLeaves field HRKPIStrip guards; here it's null/undefined
    // instead of an em dash because the briefing is a sentence, not a KPI
    // tile, but the honesty requirement is identical.

    it("shows an honest failure message, not the false all-clear, when pendingCount is null", () => {
      render(<GreetingHeader {...baseProps} pendingCount={null} payrollDaysLeft={12} />);
      const greeting = getGreeting();
      expect(within(greeting).getByText(/We couldn't load your pending actions/)).toBeInTheDocument();
      expect(within(greeting).queryByText(/No urgent actions today/)).not.toBeInTheDocument();
    });

    it("shows the same honest failure message when pendingCount is undefined", () => {
      render(<GreetingHeader {...baseProps} pendingCount={undefined} payrollDaysLeft={12} />);
      expect(within(getGreeting()).getByText(/We couldn't load your pending actions/)).toBeInTheDocument();
    });

    it("does not silently fall back to the payroll clause when pendingCount is absent, even if payroll closes soon", () => {
      // hasValue(pendingCount) must short-circuit the whole chain -- an
      // absent count can't be treated as "nothing pending, check payroll
      // instead", because that's still a disguised all-clear.
      render(<GreetingHeader {...baseProps} pendingCount={null} payrollDaysLeft={3} />);
      const greeting = getGreeting();
      expect(within(greeting).getByText(/We couldn't load your pending actions/)).toBeInTheDocument();
      expect(within(greeting).queryByText(/Payroll closes in 3 days/)).not.toBeInTheDocument();
    });
  });

  describe("genuine zero is preserved, not shown as the honest-absence state", () => {
    it("shows the real 'No urgent actions today' when pendingCount is genuinely 0 and payroll isn't close", () => {
      render(<GreetingHeader {...baseProps} pendingCount={0} payrollDaysLeft={12} />);
      const greeting = getGreeting();
      expect(within(greeting).getByText(/No urgent actions today/)).toBeInTheDocument();
      expect(within(greeting).queryByText(/We couldn't load/)).not.toBeInTheDocument();
    });

    it("still shows the payroll briefing for a genuine 0 pending count when payroll closes soon", () => {
      render(<GreetingHeader {...baseProps} pendingCount={0} payrollDaysLeft={1} />);
      expect(within(getGreeting()).getByText(/Payroll closes in 1 day\b/)).toBeInTheDocument();
    });
  });
});
