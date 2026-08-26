import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RetirementCaseWorkspace } from "./RetirementCaseWorkspace";
import type { RetirementRow } from "./RetirementDashboard";

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function rows(): RetirementRow[] {
  return [
    { id: "r1", employee: "Asha Rao", superannuationDate: inDays(60), status: "pending" },
    { id: "r2", employee: "Vikram Shah", superannuationDate: inDays(10), status: "pending" },
  ];
}

describe("RetirementCaseWorkspace", () => {
  it("defaults the wizard to the soonest-retiring employee, not a generic unattributed checklist", () => {
    // Regression test: the wizard used to be rendered with no employeeName
    // at all, so an officer processing several upcoming retirements had one
    // anonymous checklist with no indication of whose case it was.
    render(<RetirementCaseWorkspace rows={rows()} />);

    expect(screen.getByText("Vikram Shah", { selector: "strong" })).toBeInTheDocument();
  });

  it("switches the wizard to a different retiree, and does not carry over checked items", () => {
    render(<RetirementCaseWorkspace rows={rows()} />);

    // Check the first task for the initially-selected retiree (Vikram, soonest).
    fireEvent.click(screen.getByLabelText("Library clearance certificate obtained"));
    expect(screen.getByLabelText("Library clearance certificate obtained")).toBeChecked();

    // Switch to Asha's card.
    fireEvent.click(screen.getByRole("button", { name: /Process this retirement/ }));

    expect(screen.getByText("Asha Rao", { selector: "strong" })).toBeInTheDocument();
    // The wizard remounted for the new case -- the checkbox must be unchecked
    // again (it belongs to a different person's case now).
    expect(screen.getByLabelText("Library clearance certificate obtained")).not.toBeChecked();
  });

  it("shows the non-persistence disclaimer so the checklist is never mistaken for a saved record", () => {
    render(<RetirementCaseWorkspace rows={rows()} />);
    expect(screen.getByText(/Checked items are/)).toBeInTheDocument();
    expect(screen.getByText(/not saved/)).toBeInTheDocument();
  });

  it("still renders a usable wizard when there are no upcoming retirements", () => {
    render(<RetirementCaseWorkspace rows={[]} />);
    expect(screen.getByText(/No retiree selected/)).toBeInTheDocument();
  });
});
