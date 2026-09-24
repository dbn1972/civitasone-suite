import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionDenied } from "./PermissionDenied";

describe("PermissionDenied", () => {
  it("renders access restricted heading", () => {
    render(<PermissionDenied />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("shows generic message when no module is specified", () => {
    render(<PermissionDenied />);
    expect(screen.getByText(/permission to view this page/)).toBeInTheDocument();
  });

  it("shows module-specific message when module is provided", () => {
    render(<PermissionDenied module="Finance" />);
    expect(screen.getByText(/permission to view Finance/)).toBeInTheDocument();
  });

  it("shows required roles when provided", () => {
    render(<PermissionDenied requiredRoles={["finance_admin", "ddo"]} />);
    expect(screen.getByText(/Required: finance_admin, ddo/)).toBeInTheDocument();
  });

  it("renders return link to dashboard", () => {
    render(<PermissionDenied />);
    const link = screen.getByRole("link", { name: "Return to command center" });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("shows lock icon with aria-hidden", () => {
    const { container } = render(<PermissionDenied />);
    expect(container.querySelector("[aria-hidden]")?.textContent).toBe("🔒");
  });

  // `reason` carries the backend's own HttpError message for the specific
  // request that just failed (see apiClient.ts's `errorMessage` and
  // ds/LoadErrorState.tsx) -- e.g. a per-record ownership check like "not
  // one of your direct reports" that no static per-page role list could
  // ever express correctly.
  it("shows the backend's own reason, capitalized and punctuated, when provided", () => {
    render(<PermissionDenied reason="managers may only view their own direct reports' records" />);
    expect(
      screen.getByText("Managers may only view their own direct reports' records."),
    ).toBeInTheDocument();
  });

  it("leaves an already-punctuated reason alone instead of double-punctuating it", () => {
    render(<PermissionDenied reason="Requires one of: hr_admin, hr_officer, super_admin." />);
    expect(
      screen.getByText("Requires one of: hr_admin, hr_officer, super_admin."),
    ).toBeInTheDocument();
  });

  it("prefers reason over module/requiredRoles when both are given -- the live, specific answer wins over a static guess", () => {
    render(
      <PermissionDenied
        module="employee"
        requiredRoles={["hr_admin"]}
        reason="not one of your direct reports"
      />,
    );
    expect(screen.getByText("Not one of your direct reports.")).toBeInTheDocument();
    expect(screen.queryByText(/Required:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/permission to view employee/)).not.toBeInTheDocument();
  });
});
