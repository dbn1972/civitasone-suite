import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { LoadErrorState } from "./LoadErrorState";

describe("LoadErrorState", () => {
  it("shows the honest Access restricted message with the backend's own reason for a 403", () => {
    render(
      <LoadErrorState
        result={{ status: 403, errorMessage: "managers may only view their own direct reports' records" }}
        area="employee"
        backHref="/hr/employees"
      />,
    );
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(
      screen.getByText("Managers may only view their own direct reports' records."),
    ).toBeInTheDocument();
    // Never a "try again" button for a permanent authorization boundary --
    // retrying a 403 can never succeed.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("falls back to the generic Access restricted copy for a 403 with no backend reason", () => {
    render(<LoadErrorState result={{ status: 403 }} area="employee" backHref="/hr/employees" />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.getByText(/permission to view employee/)).toBeInTheDocument();
  });

  it("uses a static requiredRoles list only when the backend sent no reason of its own", () => {
    render(
      <LoadErrorState
        result={{ status: 403 }}
        area="promotions"
        requiredRoles={["hr_admin", "hr_officer", "super_admin"]}
      />,
    );
    expect(screen.getByText(/Required: hr_admin, hr_officer, super_admin/)).toBeInTheDocument();
  });

  it("shows the generic 'couldn't load, try again' message for a genuine transient failure (no status -- a network error)", () => {
    render(<LoadErrorState result={{ status: undefined }} area="employee" backHref="/hr/employees" />);
    expect(screen.getByRole("heading", { name: "We couldn't load employee." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });

  it("shows the generic retry message for a 500 too, not just a missing status", () => {
    render(<LoadErrorState result={{ status: 500 }} area="transfer" backHref="/hr" />);
    expect(screen.getByRole("heading", { name: "We couldn't load transfer." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the generic retry message for a 404 too (not a permission question at all)", () => {
    render(<LoadErrorState result={{ status: 404 }} area="employee" backHref="/hr/employees" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });
});
