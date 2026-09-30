/**
 * orgchart/queries.ts — getOrgChart (GAP-HR-ORG-CHART-01/05)
 *
 * Pattern mirrors employee/queries.test.ts: mock ../employee/repo.js
 * (listByTenant) and ../../shared/infra.js (cache.listOrLoad bypasses
 * straight to the loader) -- no real DB.
 */
import { describe, it, expect, vi } from "vitest";

const listByTenantMock = vi.fn();
const findDesignationsByIdsMock = vi.fn();
const findDepartmentsByIdsMock = vi.fn();
vi.mock("../employee/repo.js", () => ({
  listByTenant: (...args: unknown[]) => listByTenantMock(...args),
  findDesignationsByIds: (...args: unknown[]) => findDesignationsByIdsMock(...args),
  findDepartmentsByIds: (...args: unknown[]) => findDepartmentsByIdsMock(...args),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    listOrLoad: (_tenantId: string, _resource: string, _hash: string, loader: () => unknown) => loader(),
  },
}));

import { getOrgChart } from "./queries.js";

const TENANT = "tenant-1";

function emp(overrides: Partial<{
  id: string;
  fullName: string;
  designationId: string;
  departmentId: string;
  managerId: string | null;
  status: string;
}>) {
  return {
    id: "emp-0",
    fullName: "Unnamed",
    designationId: "desig-0",
    departmentId: "dept-0",
    managerId: null,
    status: "confirmed",
    ...overrides,
  };
}

describe("getOrgChart", () => {
  it("resolves designation/department ids to real names, not id fragments", async () => {
    listByTenantMock.mockResolvedValue([
      emp({ id: "e1", fullName: "Amit Singh", designationId: "desig-secretary", departmentId: "dept-finance" }),
    ]);
    findDesignationsByIdsMock.mockResolvedValue([{ id: "desig-secretary", name: "Secretary" }]);
    findDepartmentsByIdsMock.mockResolvedValue([{ id: "dept-finance", name: "Ministry of Finance" }]);

    const tree = await getOrgChart(TENANT);
    expect(tree).toHaveLength(1);
    const root = tree[0]!;

    expect(root.designation).toBe("Secretary");
    expect(root.department).toBe("Ministry of Finance");
    // Never the old bug: a raw id fragment standing in for the name.
    expect(root.designation).not.toBe("desig-se");
  });

  it("falls back to an em dash when a designation/department id no longer resolves", async () => {
    listByTenantMock.mockResolvedValue([
      emp({ id: "e1", designationId: "desig-deleted", departmentId: "dept-deleted" }),
    ]);
    findDesignationsByIdsMock.mockResolvedValue([]);
    findDepartmentsByIdsMock.mockResolvedValue([]);

    const tree = await getOrgChart(TENANT);
    const root = tree[0]!;

    expect(root.designation).toBe("—");
    expect(root.department).toBe("—");
  });

  it("GAP-HR-ORG-CHART-05: surfaces an employee whose manager has separated as a root, not as a dropped node", async () => {
    listByTenantMock.mockResolvedValue([
      emp({ id: "mgr", fullName: "Old Manager", managerId: null, status: "separated" }),
      emp({ id: "report", fullName: "Direct Report", managerId: "mgr", status: "confirmed" }),
    ]);
    findDesignationsByIdsMock.mockResolvedValue([]);
    findDepartmentsByIdsMock.mockResolvedValue([]);

    const tree = await getOrgChart(TENANT);

    // The separated manager is filtered out of `active` entirely, and the
    // report's stale managerId must not leak through as a truthy
    // `reportsTo` -- otherwise the client's `!reportsTo` root filter would
    // silently drop this whole subtree instead of showing it as a root.
    expect(tree).toHaveLength(1);
    const root = tree[0]!;
    expect(root.id).toBe("report");
    expect(root.reportsTo).toBeNull();
  });

  it("keeps a normal manager/report relationship as a nested child, not a second root", async () => {
    listByTenantMock.mockResolvedValue([
      emp({ id: "mgr", fullName: "Active Manager", managerId: null, status: "confirmed" }),
      emp({ id: "report", fullName: "Direct Report", managerId: "mgr", status: "confirmed" }),
    ]);
    findDesignationsByIdsMock.mockResolvedValue([]);
    findDepartmentsByIdsMock.mockResolvedValue([]);

    const tree = await getOrgChart(TENANT);
    expect(tree).toHaveLength(1);
    const root = tree[0]!;

    expect(root.id).toBe("mgr");
    expect(root.children).toHaveLength(1);
    const child = root.children![0]!;
    expect(child.id).toBe("report");
    expect(child.reportsTo).toBe("mgr");
  });
});
