import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

    // "hr" and "payroll" module rows (now humanised to "Hr"/"Payroll" per
    // ROLES-06), "Read"/"Create" action columns are all derived from the real
    // `permissions` prop, not a hardcoded taxonomy.
    await waitFor(() => expect(screen.getAllByText("Hr").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Payroll").length).toBeGreaterThan(0);
    // No fabricated module ever appears (the old DEFAULTS baseline invented
    // "finance", "procurement", "leave", "audit", "reports", "settings").
    expect(screen.queryByText("Finance")).not.toBeInTheDocument();
    expect(screen.queryByText("Procurement")).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("Hr").length).toBeGreaterThan(0));

    const toggles = await screen.findAllByTitle(/click to grant/i);
    toggles[0].click();

    const saveButton = await screen.findByRole("button", { name: /save 1 change/i });
    saveButton.click();

    // ROLES-03: a reason is required before the confirm button enables.
    const reasonField = await screen.findByLabelText(/reason for this rbac change/i);
    fireEvent.change(reasonField, { target: { value: "granting read access" } });
    const confirmButton = await screen.findByRole("button", { name: /^save changes$/i });
    confirmButton.click();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/1 permission change saved/i));

    const patchCall = fetchSpy.mock.calls.find(([input, init]) => String(input) === "/api/proxy/v1/admin/roles/role-hr-admin/permissions" && (init as RequestInit | undefined)?.method === "PATCH");
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string) as { permissionKeys: string[]; reason?: string };
    expect(body.permissionKeys).toContain("hr.read");
    expect(body.reason).toBe("granting read access");
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
    await waitFor(() => expect(screen.getAllByText("Hr").length).toBeGreaterThan(0));

    const toggles = await screen.findAllByTitle(/click to grant/i);
    toggles[0].click();
    const saveButton = await screen.findByRole("button", { name: /save 1 change/i });
    saveButton.click();
    const reasonField = await screen.findByLabelText(/reason for this rbac change/i);
    fireEvent.change(reasonField, { target: { value: "attempt change" } });
    const confirmButton = await screen.findByRole("button", { name: /^save changes$/i });
    confirmButton.click();

    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/1 failed \(HR Admin\)\. Only the failed role remain unsaved/i));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // Never renders editable/toggleable cells for a system role -- there is no
  // real backend command to mutate a system role's fixed grant set.
  it("never renders an editable toggle for a system role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "role-super-admin", permissions: ["hr.read"] }), { status: 200 }),
    );
    render(<RolePermissionsMatrix roles={[roles[1]]} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getAllByText("Hr").length).toBeGreaterThan(0));
    expect(screen.queryAllByTitle(/click to (grant|revoke)/i)).toHaveLength(0);
  });

  // UX-016: this error text used to be the backend's raw `message` field (or
  // a bare `HTTP ${status}` fallback) shown verbatim. It must now show only
  // the catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe load error for a role, not the raw server text, instead of silently rendering an empty grant set", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/v1/admin/roles/role-hr-admin") {
        return new Response(JSON.stringify({ message: "role not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ id: "role-super-admin", permissions: [] }), { status: 200 });
    });
    render(<RolePermissionsMatrix roles={roles} permissions={permissions} source="api" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText("role not found")).not.toBeInTheDocument();
  });
});

describe("RolePermissionsMatrix a11y + partial-save (GAP-PLATFORM-ADMIN-ROLES-03/04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  // ROLES-04: each editable toggle has a context-rich accessible name
  // ("<Module> <Action>: granted/not granted") rather than just "On"/"Off".
  it("gives each toggle a context-rich accessible name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "role-hr-admin", permissions: ["hr.read"] }), { status: 200 }),
    );
    render(<RolePermissionsMatrix roles={[roles[0]]} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getAllByText("Hr").length).toBeGreaterThan(0));
    // hr.read is granted -> a button named "Hr Read: granted".
    expect(screen.getByRole("button", { name: /Hr Read: granted/i })).toBeInTheDocument();
    // hr.create is not granted -> "Hr Create: not granted".
    expect(screen.getByRole("button", { name: /Hr Create: not granted/i })).toBeInTheDocument();
  });

  // ROLES-03: a partial failure reports BOTH saved and failed roles.
  it("reports both saved and failed roles on a partial failure", async () => {
    const editableRoles: AdminRoleSummary[] = [
      { id: "role-a", key: "role_a", name: "Role A", description: null, isSystem: false },
      { id: "role-b", key: "role_b", name: "Role B", description: null, isSystem: false },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method;
      if (url === "/api/proxy/v1/admin/roles/role-a" && !method) return new Response(JSON.stringify({ id: "role-a", permissions: [] }), { status: 200 });
      if (url === "/api/proxy/v1/admin/roles/role-b" && !method) return new Response(JSON.stringify({ id: "role-b", permissions: [] }), { status: 200 });
      // Role A saves, Role B fails.
      if (url === "/api/proxy/v1/admin/roles/role-a/permissions") return new Response(null, { status: 202 });
      if (url === "/api/proxy/v1/admin/roles/role-b/permissions") return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
      throw new Error(`unexpected ${url} ${method ?? "GET"}`);
    });

    render(<RolePermissionsMatrix roles={editableRoles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getAllByText("Hr").length).toBeGreaterThan(0));

    // Grant hr.read on both roles.
    const toggles = await screen.findAllByRole("button", { name: /Hr Read: not granted/i });
    toggles.forEach((t) => t.click());

    const saveButton = await screen.findByRole("button", { name: /save \d+ change/i });
    saveButton.click();
    const reasonField = await screen.findByLabelText(/reason for this rbac change/i);
    fireEvent.change(reasonField, { target: { value: "bulk grant" } });
    (await screen.findByRole("button", { name: /^save changes$/i })).click();

    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/1 saved \(Role A\)/i));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/1 failed \(Role B\)/i);
  });
});
