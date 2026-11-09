import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getSessionRolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => getSessionRolesMock() };
});

import { RoleCommandCenter } from "./RoleCommandCenter";

describe("RoleCommandCenter", () => {
  beforeEach(() => getSessionRolesMock.mockReset());

  it("GAP-DASHBOARD-HOME-2-01: renders no static 'Urgent' pill", () => {
    getSessionRolesMock.mockReturnValue(["finance_officer"]);
    render(<RoleCommandCenter />);
    expect(screen.getByText("Finance Command Center")).toBeInTheDocument();
    expect(screen.queryByText("Urgent")).not.toBeInTheDocument();
  });

  it("GAP-DASHBOARD-HOME-2-01: copy is honest 'Shortcuts for your role', not a live-action claim", () => {
    getSessionRolesMock.mockReturnValue(["finance_officer"]);
    render(<RoleCommandCenter />);
    expect(screen.getByText("Shortcuts for your role.")).toBeInTheDocument();
    expect(screen.queryByText(/What needs your action now/i)).not.toBeInTheDocument();
  });

  it("GAP-DASHBOARD-HOME-2-02: a cadre role 'chr_manager' does NOT get the HR command center", () => {
    getSessionRolesMock.mockReturnValue(["chr_manager"]);
    render(<RoleCommandCenter />);
    expect(screen.queryByText("HR & Payroll Command Center")).not.toBeInTheDocument();
  });

  it("GAP-DASHBOARD-HOME-2-02: an 'hr_officer' DOES get the HR command center", () => {
    getSessionRolesMock.mockReturnValue(["hr_officer"]);
    render(<RoleCommandCenter />);
    expect(screen.getByText("HR & Payroll Command Center")).toBeInTheDocument();
  });

  // UAT b23: "All approvals" pointed at the /workflow analytics hub.
  it("UAT b23: All approvals opens the /approvals inbox for a role that can read tasks", () => {
    getSessionRolesMock.mockReturnValue(["procurement_officer"]);
    render(<RoleCommandCenter />);
    expect(screen.getByRole("link", { name: /All approvals/ })).toHaveAttribute("href", "/approvals");
  });

  it("UAT b23: an analytics-only role (tenant_admin) gets the /workflow hub link", () => {
    getSessionRolesMock.mockReturnValue(["tenant_admin"]);
    render(<RoleCommandCenter />);
    expect(screen.getByRole("link", { name: /All approvals/ })).toHaveAttribute("href", "/workflow");
  });

  it("UAT b23: All approvals is hidden for a role the inbox would turn away (finance_officer)", () => {
    getSessionRolesMock.mockReturnValue(["finance_officer"]);
    render(<RoleCommandCenter />);
    expect(screen.getByText("Finance Command Center")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /All approvals/ })).not.toBeInTheDocument();
  });

  it("renders nothing when no role matches", () => {
    getSessionRolesMock.mockReturnValue(["citizen"]);
    const { container } = render(<RoleCommandCenter />);
    expect(container).toBeEmptyDOMElement();
  });
});
