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

// GAP-HR-DASHBOARD-05: "Run Payroll" links to /hr/payroll, which renders
// PermissionDenied for any role outside PAYROLL_READER_ROLES -- a manager (and
// hr_officer) would click straight into that wall.
describe("QuickActionsPanel — Run Payroll only where /hr/payroll opens (GAP-HR-DASHBOARD-05)", () => {
  it("does not offer Run Payroll to the manager variant", () => {
    render(<QuickActionsPanel variant="manager" />);
    expect(screen.queryByRole("link", { name: /run payroll/i })).not.toBeInTheDocument();
    // The actions that DO work for a manager are still there.
    expect(screen.getByRole("link", { name: /approve leaves/i })).toBeInTheDocument();
  });

  it("offers Run Payroll to the admin variant by default", () => {
    render(<QuickActionsPanel variant="admin" />);
    expect(screen.getByRole("link", { name: /run payroll/i })).toHaveAttribute("href", "/hr/payroll");
  });

  it("drops Run Payroll from the admin variant when the viewer cannot open the payroll page", () => {
    render(<QuickActionsPanel variant="admin" canViewPayroll={false} />);
    expect(screen.queryByRole("link", { name: /run payroll/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add employee/i })).toBeInTheDocument();
  });
});
