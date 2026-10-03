import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PayrollBanner } from "./PayrollBanner";
import { englishDays } from "./useDays";

const baseProps = { daysLeft: 5, monthName: "September 2026", headcount: 245, canRunPayroll: true };

describe("PayrollBanner (GAP-HR-DASHBOARD-05)", () => {
  it("pluralizes correctly for exactly 1 day left", () => {
    render(<PayrollBanner {...baseProps} daysLeft={1} />);
    expect(screen.getByText(/Deadline in 1 day\b/)).toBeInTheDocument();
    expect(screen.queryByText(/1 days/)).not.toBeInTheDocument();
  });

  it("is a polite status, not an assertive alert", () => {
    render(<PayrollBanner {...baseProps} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the Start Run link when the viewer can run payroll", () => {
    render(<PayrollBanner {...baseProps} canRunPayroll />);
    expect(screen.getByRole("link", { name: /start run/i })).toBeInTheDocument();
  });

  it("hides the Start Run link for a manager who cannot run payroll", () => {
    render(<PayrollBanner {...baseProps} canRunPayroll={false} />);
    expect(screen.queryByRole("link", { name: /start run/i })).not.toBeInTheDocument();
    // The informational content itself still renders -- only the dead-end
    // action link is hidden.
    expect(screen.getByText(/Payroll Processing/i)).toBeInTheDocument();
  });

  // GAP-HR-DASHBOARD-05: with a real next-intl provider the count goes through
  // the ICU plural key (dashboardDays.count), not the hand-rolled fallback.
  it("uses the ICU plural catalogue when a provider is present (1 day / 5 days)", () => {
    const wrap = (daysLeft: number) => render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PayrollBanner {...baseProps} daysLeft={daysLeft} />
      </NextIntlClientProvider>,
    );
    const one = wrap(1);
    expect(screen.getByText(/Deadline in 1 day\b/)).toBeInTheDocument();
    one.unmount();
    wrap(5);
    expect(screen.getByText(/Deadline in 5 days/)).toBeInTheDocument();
  });

  it("englishDays fallback pluralises 0, 1 and many", () => {
    expect([englishDays(0), englishDays(1), englishDays(2)]).toEqual(["0 days", "1 day", "2 days"]);
  });
});
