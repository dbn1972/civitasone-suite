import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { LoadErrorState } from "./LoadErrorState";

describe("LoadErrorState", () => {
  it("shows Access restricted with the standard 403 copy for a 403, never the backend's own text", () => {
    render(
      <LoadErrorState
        result={{ status: 403, errorMessage: "managers may only view their own direct reports' records" }}
        area="employee"
        backHref="/hr/employees"
      />,
    );
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to do this. Ask your administrator if you need access.")).toBeInTheDocument();
    expect(screen.queryByText(/direct reports/i)).not.toBeInTheDocument();
    // Never a "try again" button for a permanent authorization boundary.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("a 403 with a self-approval code keeps its specific copy", () => {
    render(<LoadErrorState result={{ status: 403, errorCode: "SELF_APPROVAL_FORBIDDEN" }} area="request" />);
    expect(screen.getByText("You can't approve your own request. Another approver needs to do this.")).toBeInTheDocument();
  });

  it("does not show a static role list (internal role slugs) for a 403", () => {
    render(<LoadErrorState result={{ status: 403 }} area="promotions" requiredRoles={["hr_admin", "hr_officer"]} />);
    expect(screen.queryByText(/hr_admin/)).not.toBeInTheDocument();
  });

  it("says it could not connect, with Try again, when there is no status (a network error)", () => {
    render(<LoadErrorState result={{ status: undefined }} area="employee" backHref="/hr/employees" />);
    expect(screen.getByRole("heading", { name: "We couldn't connect." })).toBeInTheDocument();
    expect(screen.getByText("Check your internet connection and try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });

  it("says it is a problem on our side for a 500, with Try again", () => {
    render(<LoadErrorState result={{ status: 500 }} area="transfer" backHref="/hr" />);
    expect(
      screen.getByRole("heading", { name: "We couldn't load the transfer because of a problem on our side." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Try again in a few minutes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("says it could not find the object for a 404, still with Try again (not a permission question at all)", () => {
    render(<LoadErrorState result={{ status: 404 }} area="employee" backHref="/hr/employees" />);
    expect(screen.getByRole("heading", { name: "We couldn't find this employee." })).toBeInTheDocument();
    expect(screen.getByText("It may have been removed or the link may be wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });

  it("asks the user to sign in again for a 401, with no Try again button", () => {
    render(<LoadErrorState result={{ status: 401 }} area="employee" backHref="/hr/employees" />);
    expect(screen.getByRole("heading", { name: "Your session has ended." })).toBeInTheDocument();
    expect(screen.getByText("Sign in again to continue.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("a known domain code wins over the generic status copy", () => {
    render(<LoadErrorState result={{ status: 409, errorCode: "STALE_ELECTION" }} area="election" />);
    expect(screen.getByRole("heading", { name: "This election was changed by someone else." })).toBeInTheDocument();
  });

  it("never renders a status number or the backend's text for a non-403 failure", () => {
    const { container } = render(
      <LoadErrorState result={{ status: 503, errorMessage: "upstream payroll-svc circuit open" }} area="transfer" />,
    );
    expect(container.textContent).not.toMatch(/\b503\b/);
    expect(container.textContent).not.toContain("circuit open");
  });
});
