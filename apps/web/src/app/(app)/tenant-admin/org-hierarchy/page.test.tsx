import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getOrgHierarchyMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getOrgHierarchy: (...a: unknown[]) => getOrgHierarchyMock(...a),
}));

const rolesMock = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  hasAnyRole: (session: string[], allowed: string[]) => allowed.some((r) => session.includes(r)),
}));

import OrgHierarchyPage from "./page";

const TREE = [
  { id: "root", name: "District Office", headCount: 1, children: [
    { id: "a", name: "Revenue", headCount: 5, children: [] },
    { id: "b", name: "Works", headCount: 5, children: [] },
  ] },
];

describe("OrgHierarchyPage", () => {
  beforeEach(() => {
    getOrgHierarchyMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["tenant_admin"]);
  });

  // GAP-TENANT-ADMIN-ORG-HIERARCHY-01: no false ARIA tree contract.
  it("renders a plain nested list, not role=tree/treeitem with aria-expanded", async () => {
    getOrgHierarchyMock.mockResolvedValue({ data: TREE, source: "api" });
    const { container } = render(await OrgHierarchyPage());
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelector('[role="treeitem"]')).toBeNull();
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    // nested <ul> exists (depth semantics)
    expect(container.querySelectorAll("ul ul").length).toBeGreaterThanOrEqual(1);
  });

  // GAP-TENANT-ADMIN-ORG-HIERARCHY-03: actionable links present.
  it("links to Manage units and Organisation type", async () => {
    getOrgHierarchyMock.mockResolvedValue({ data: TREE, source: "api" });
    render(await OrgHierarchyPage());
    expect(screen.getByRole("link", { name: /Manage units/i })).toHaveAttribute("href", "/admin/org");
    expect(screen.getByRole("link", { name: /Organisation type/i })).toHaveAttribute("href", "/tenant-admin/org-type");
    // hierarchy-levels link hidden for non-platform roles
    expect(screen.queryByRole("link", { name: /Hierarchy levels/i })).not.toBeInTheDocument();
  });

  it("shows the Hierarchy levels link for platform_admin", async () => {
    rolesMock.mockReturnValue(["platform_admin"]);
    getOrgHierarchyMock.mockResolvedValue({ data: TREE, source: "api" });
    render(await OrgHierarchyPage());
    expect(screen.getByRole("link", { name: /Hierarchy levels/i })).toHaveAttribute("href", "/platform-admin/org-config");
  });

  // GAP-TENANT-ADMIN-ORG-HIERARCHY-04: "Units" label with the all-node count (3).
  it("labels the count 'Units' and counts every node including root", async () => {
    getOrgHierarchyMock.mockResolvedValue({ data: TREE, source: "api" });
    render(await OrgHierarchyPage());
    expect(screen.getByText("Units").closest(".stat")).toHaveTextContent("3");
    expect(screen.queryByText("Departments")).not.toBeInTheDocument();
  });
});
