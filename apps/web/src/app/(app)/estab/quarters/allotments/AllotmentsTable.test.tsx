import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

import { AllotmentsTable, type AllotmentRow } from "./AllotmentsTable";

const mk = (id: string, status: string, name: string, score: number): AllotmentRow => ({
  id, quarterId: "q-" + id, employeeRef: "e-" + id, employeeName: name, quarterNo: "B-" + id,
  designation: null, payLevel: "7", eligibilityScore: score, appliedAt: "2026-09-01T00:00:00Z", status, version: 1,
});
const ROWS = [mk("1", "waitlisted", "Wanda Waitlist", 40), mk("2", "allotted", "Alan Allotted", 90), mk("3", "applied", "Ann Applied", 60)];

describe("AllotmentsTable — GAP-ESTAB-QUARTERS-ALLOTMENTS-05", () => {
  it("shows an Eligibility column", () => {
    render(<AllotmentsTable allotments={ROWS} />);
    expect(screen.getByRole("columnheader", { name: /Eligibility/ })).toBeInTheDocument();
  });

  it("Given the Waitlisted segment is chosen, Then only waitlisted rows remain; All restores them", () => {
    render(<AllotmentsTable allotments={ROWS} />);
    expect(screen.getByText("Alan Allotted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Waitlisted" }));
    expect(screen.getByText("Wanda Waitlist")).toBeInTheDocument();
    expect(screen.queryByText("Alan Allotted")).not.toBeInTheDocument();
    expect(screen.queryByText("Ann Applied")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("Alan Allotted")).toBeInTheDocument();
  });
});
