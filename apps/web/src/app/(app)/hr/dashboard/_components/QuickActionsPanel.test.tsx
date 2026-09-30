import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickActionsPanel } from "./QuickActionsPanel";

// GAP-HR-DASHBOARD-06: "Download Report" used to link to /hr/payroll -- not
// a report of any kind, a dead-end link for a viewer without payroll access.
describe("QuickActionsPanel (GAP-HR-DASHBOARD-06)", () => {
  it("does not link Download Report to /hr/payroll for the admin variant", () => {
    render(<QuickActionsPanel variant="admin" />);
    const link = screen.getByRole("link", { name: /download report/i });
    expect(link).not.toHaveAttribute("href", "/hr/payroll");
    expect(link).toHaveAttribute("href", "/reports/list/new?reportType=hr");
  });

  it("does not link Download Report to /hr/payroll for the manager variant", () => {
    render(<QuickActionsPanel variant="manager" />);
    const link = screen.getByRole("link", { name: /download report/i });
    expect(link).not.toHaveAttribute("href", "/hr/payroll");
  });
});
