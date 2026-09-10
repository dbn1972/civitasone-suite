import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RolePermissionsMatrix } from "./RolePermissionsMatrix";
import type { AdminRoleSummary, AdminPermissionSummary } from "@/app/_data/loaders";

const roles: AdminRoleSummary[] = [
  { id: "role-hr-admin", key: "hr_admin", name: "HR Admin", description: null, isSystem: false },
  { id: "role-super-admin", key: "super_admin", name: "Super Admin", description: null, isSystem: true },
];

const permissions: AdminPermissionSummary[] = [
  { id: "perm-hr-read", key: "hr.read", name: "View HR", description: null },
  { id: "perm-hr-create", key: "hr.create", name: "Create HR records", description: null },
  { id: "perm-payroll-read", key: "payroll.read", name: "View payroll", description: null },
];

describe("RolePermissionsMatrix (COMP-013: real per-role, real per-permission matrix)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Regression test for the bug this page replaced: the old page invented a
  // 9-role x 8-module x 6-action matrix (ROLES / DEFAULTS constants) with no
  // loader and no GET call anywhere. This asserts the real contract: the grid
  // is built from the real roles/permissions props and each role's granted
  // state comes from a real per-role GET, never a fabricated baseline.
  it("renders the module/action grid from real permission keys and loads each role's real granted state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/v1/admin/roles/role-hr-admin") {
        return new Response(JSON.stringify({ id: "role-hr-admin", permissions: ["hr.read", "hr.create"] }), { status: 200 });
      }
      if (url === "/api/proxy/v1/admin/roles/role-super-admin") {
        return new Response(JSON.stringify({ id: "role-super-admin", permissions: ["hr.read", "hr.create", "payroll.read"] }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<RolePermissionsMatrix roles={roles} permissions={permissions} source="api" />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/v1/admin/roles/role-hr-admin"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/v1/admin/roles/role-super-admin");

    // "hr" and "payroll" module rows, "read"/"create" action columns are all
    // derived from the real `permissions` prop, not a hardcoded taxonomy.
    await waitFor(() => expect(screen.getAllByText("hr").length).toBeGreaterThan(0));
    expect(screen.getAllByText("payroll").length).toBeGreaterThan(0);
    // No fabricated module ever appears (the old DEFAULTS baseline invented
    // "finance", "procurement", "leave", "audit", "reports", "settings").
    expect(screen.queryByText("finance")).not.toBeInTheDocument();
    expect(screen.queryByText("procurement")).not.toBeInTheDocument();
  });

  it("saves only the real grant/revoke diff per dirty role via the real PATCH endpoint, never a bulk fabricated payload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/proxy/v1/admin/roles/role-hr-admin" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ id: "role-hr-admin", permissions: ["hr.read"] }), { status: 200 });
      }
      if (url === "/api/proxy/v1/admin/roles/role-super-admin") {
        return new Response(JSON.stringify({ id: "role-super-admin", permissions: [] }), { status: 200 });
      }
      if (url === "/api/proxy/v1/admin/roles/role-hr-admin/permissions" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ roleId: "role-hr-admin", status: "accepted" }), { status: 202 });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    render(<RolePermissionsMatrix roles={roles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getAllByText("hr").length).toBeGreaterThan(0));

    const toggles = await screen.findAllByTitle(/click to grant/i);
    toggles[0].click();

    const saveButton = await screen.findByRole("button", { name: /save 1 change/i });
    saveButton.click();

    const confirmButton = await screen.findByRole("button", { name: /^save changes$/i });
    confirmButton.click();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 permission change saved."));

    const patchCall = fetchSpy.mock.calls.find(([input, init]) => String(input) === "/api/proxy/v1/admin/roles/role-hr-admin/permissions" && (init as RequestInit | undefined)?.method === "PATCH");
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string) as { permissionKeys: string[] };
    expect(body.permissionKeys).toContain("hr.read");
  });

  // Sabotage check for the exact bug in the gap report: saveChanges() used
  // to do `await fetch(...).catch(() => null)`, swallowing every failure
  // (network error, 4xx, 5xx alike) and always showing a fake success. This
  // proves a real backend failure now surfaces as a real, visible error.
  it("shows a real save error instead of a fake success notice when the backend rejects the change", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/proxy/v1/admin/roles/role-hr-admin" && !init?.method) {
        return new Response(JSON.stringify({ id: "role-hr-admin", permissions: [] }), { status: 200 });
      }
      if (url === "/api/proxy/v1/admin/roles/role-super-admin") {
        return new Response(JSON.stringify({ id: "role-super-admin", permissions: [] }), { status: 200 });
      }
      if (url === "/api/proxy/v1/admin/roles/role-hr-admin/permissions") {
        return new Response(JSON.stringify({ message: "role not found" }), { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<RolePermissionsMatrix roles={roles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getAllByText("hr").length).toBeGreaterThan(0));

    const toggles = await screen.findAllByTitle(/click to grant/i);
    toggles[0].click();
    const saveButton = await screen.findByRole("button", { name: /save 1 change/i });
    saveButton.click();
    const confirmButton = await screen.findByRole("button", { name: /^save changes$/i });
    confirmButton.click();

    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/failed to save/i));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // Never renders editable/toggleable cells for a system role -- there is no
  // real backend command to mutate a system role's fixed grant set.
  it("never renders an editable toggle for a system role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "role-super-admin", permissions: ["hr.read"] }), { status: 200 }),
    );
    render(<RolePermissionsMatrix roles={[roles[1]]} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getAllByText("hr").length).toBeGreaterThan(0));
    expect(screen.queryAllByTitle(/click to (grant|revoke)/i)).toHaveLength(0);
  });

  it("shows a real load error for a role instead of silently rendering an empty grant set", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/v1/admin/roles/role-hr-admin") {
        return new Response(JSON.stringify({ message: "role not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ id: "role-super-admin", permissions: [] }), { status: 200 });
    });
    render(<RolePermissionsMatrix roles={roles} permissions={permissions} source="api" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not found|http 404/i);
  });
});
