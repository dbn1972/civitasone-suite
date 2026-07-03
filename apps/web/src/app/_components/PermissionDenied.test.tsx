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
});
