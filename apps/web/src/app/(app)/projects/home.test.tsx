import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn<() => string[]>();
const requireAnyRoleMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
  requireAnyRole: (...args: unknown[]) => requireAnyRoleMock(...args),
  PROJECT_WRITE_ROLES: ["project_manager", "project_officer", "super_admin"],
}));
// new/page.tsx (concurrently owned by GAP-PROJECTS-NEW-01/03) loads schemes.
vi.mock("../../../_data/loaders", () => ({ getSchemes: async () => ({ data: [], source: "api" }) }));
vi.mock("./new/CreateProjectForm", () => ({ CreateProjectForm: () => <div>create-form</div> }));

import HubPage from "./page";
import NewProjectPage from "./new/page";

describe("GAP-PROJECTS-HOME-01 create-action role gating", () => {
  beforeEach(() => {
    rolesMock.mockReset();
    requireAnyRoleMock.mockReset();
  });

  it("hub hides '+ New Project' for a viewer", () => {
    rolesMock.mockReturnValue(["viewer"]);
    render(HubPage());
    expect(screen.queryByText("+ New Project")).not.toBeInTheDocument();
  });

  it("hub shows '+ New Project' for a project_manager", () => {
    rolesMock.mockReturnValue(["project_manager"]);
    render(HubPage());
    expect(screen.getByText("+ New Project")).toBeInTheDocument();
  });

  it("/projects/new enforces a project-write role gate server-side (requireAnyRole)", async () => {
    rolesMock.mockReturnValue(["project_manager"]);
    await NewProjectPage();
    expect(requireAnyRoleMock).toHaveBeenCalledWith(
      ["project_manager", "project_officer", "super_admin"],
      "/projects",
    );
  });
});
