import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { HRKPIStrip } from "./HRKPIStrip";

// Distinct, non-colliding real values so text queries scoped to the wrong
// card would fail loudly instead of accidentally matching a neighbour.
const baseProps = {
  headcount: 245,
  headcountLastMonth: 240,
  pendingLeaves: 3,
  onLeave: 2,
  departments: 12,
  attendanceTodayPct: 87,
  payrollDaysLeft: 5,
};

function getCard(container: HTMLElement, label: string): HTMLElement {
  const labelEl = within(container).getByText(label);
  const card = labelEl.closest(".kpi-card");
  if (!card) throw new Error(`No .kpi-card ancestor found for label "${label}"`);
  return card as HTMLElement;
}

describe("HRKPIStrip", () => {
  it("renders real values for every KPI", () => {
    const { container } = render(<HRKPIStrip {...baseProps} />);
    expect(within(getCard(container, "Headcount")).getByText("245")).toBeInTheDocument();
    // { selector: ".kpi-val" } disambiguates from the "3" that also appears
    // in the urgent-count badge within the same card.
    expect(
      within(getCard(container, "Pending Approvals")).getByText("3", { selector: ".kpi-val" })
    ).toBeInTheDocument();
    expect(within(getCard(container, "On Leave Today")).getByText("2")).toBeInTheDocument();
    expect(within(getCard(container, "Departments")).getByText("12")).toBeInTheDocument();
    expect(within(getCard(container, "Present Today")).getByText("87%")).toBeInTheDocument();
    expect(within(getCard(container, "Payroll Closes")).getByText("5 days")).toBeInTheDocument();
  });

  describe("fabricated zero vs honest — (absent data)", () => {
    // A KPI with no real value (fetch failed) must read as "we don't know",
    // not as a fabricated zero -- a hard `0` is visually indistinguishable
    // from a genuine zero count. Same bug class as StatCard.tsx's Bug A.

    it("renders em dash for headcount when null", () => {
      const { container } = render(<HRKPIStrip {...baseProps} headcount={null} />);
      expect(within(getCard(container, "Headcount")).getByText("—")).toBeInTheDocument();
    });

    it("renders em dash for headcount when undefined", () => {
      const { container } = render(<HRKPIStrip {...baseProps} headcount={undefined} />);
      expect(within(getCard(container, "Headcount")).getByText("—")).toBeInTheDocument();
    });

    it("renders em dash for pendingLeaves when null, with no urgent badge and a 'No data' trend", () => {
      const { container } = render(<HRKPIStrip {...baseProps} pendingLeaves={null} />);
      const card = getCard(container, "Pending Approvals");
      expect(within(card).getByText("—")).toBeInTheDocument();
      expect(within(card).getByText("No data")).toBeInTheDocument();
      expect(within(card).queryByRole("status")).not.toBeInTheDocument();
    });

    it("renders em dash for onLeave when undefined", () => {
      const { container } = render(<HRKPIStrip {...baseProps} onLeave={undefined} />);
      const card = getCard(container, "On Leave Today");
      expect(within(card).getByText("—")).toBeInTheDocument();
      expect(within(card).getByText("No data")).toBeInTheDocument();
    });

    it("renders em dash for departments when null", () => {
      const { container } = render(<HRKPIStrip {...baseProps} departments={null} />);
      const card = getCard(container, "Departments");
      expect(within(card).getByText("—")).toBeInTheDocument();
      expect(within(card).getByText("No data")).toBeInTheDocument();
    });

    it("renders em dash and 'Sync offline' for attendanceTodayPct when null", () => {
      const { container } = render(<HRKPIStrip {...baseProps} attendanceTodayPct={null} />);
      const card = getCard(container, "Present Today");
      expect(within(card).getByText("—")).toBeInTheDocument();
      expect(within(card).getByText("Sync offline")).toBeInTheDocument();
    });

    it("keeps the real headcount but shows 'No data' trend when only headcountLastMonth is missing", () => {
      const { container } = render(<HRKPIStrip {...baseProps} headcountLastMonth={null} />);
      const card = getCard(container, "Headcount");
      expect(within(card).getByText("245")).toBeInTheDocument();
      expect(within(card).getByText("No data")).toBeInTheDocument();
    });

    it("renders every dashboard-sourced KPI as — when the whole load failed, while the locally-computed payrollDaysLeft still renders", () => {
      const { container } = render(
        <HRKPIStrip
          headcount={null}
          headcountLastMonth={null}
          pendingLeaves={null}
          onLeave={null}
          departments={null}
          attendanceTodayPct={null}
          payrollDaysLeft={5}
        />
      );
      for (const label of ["Headcount", "Pending Approvals", "On Leave Today", "Departments", "Present Today"]) {
        expect(within(getCard(container, label)).getByText("—")).toBeInTheDocument();
      }
      expect(within(getCard(container, "Payroll Closes")).getByText("5 days")).toBeInTheDocument();
    });
  });

  describe("genuine zero is preserved, not shown as —", () => {
    it("shows 0 pending leave requests as 0, not —, with an 'Inbox clear' trend and no badge", () => {
      const { container } = render(<HRKPIStrip {...baseProps} pendingLeaves={0} />);
      const card = getCard(container, "Pending Approvals");
      expect(within(card).getByText("0")).toBeInTheDocument();
      expect(within(card).getByText("Inbox clear")).toBeInTheDocument();
      expect(within(card).queryByRole("status")).not.toBeInTheDocument();
      expect(within(card).queryByText("—")).not.toBeInTheDocument();
    });

    it("shows 0 employees on leave as 0, not —", () => {
      const { container } = render(<HRKPIStrip {...baseProps} onLeave={0} />);
      const card = getCard(container, "On Leave Today");
      expect(within(card).getByText("0")).toBeInTheDocument();
      expect(within(card).getByText("No leave today")).toBeInTheDocument();
      expect(within(card).queryByText("—")).not.toBeInTheDocument();
    });

    it("shows a genuine 0% attendance as 0%, not —, and does not call it 'Sync offline'", () => {
      const { container } = render(<HRKPIStrip {...baseProps} attendanceTodayPct={0} />);
      const card = getCard(container, "Present Today");
      expect(within(card).getByText("0%")).toBeInTheDocument();
      expect(within(card).getByText("Live attendance")).toBeInTheDocument();
      expect(within(card).queryByText("Sync offline")).not.toBeInTheDocument();
    });

    it("shows a genuine zero-change headcount trend as a flat glyph, distinct from the unknown-trend 'No data' case", () => {
      const { container } = render(<HRKPIStrip {...baseProps} headcount={240} headcountLastMonth={240} />);
      const card = getCard(container, "Headcount");
      expect(within(card).getByText("240")).toBeInTheDocument();
      expect(within(card).getByText("— 0 this month")).toBeInTheDocument();
    });
  });
});
