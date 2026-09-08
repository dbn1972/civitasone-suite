import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RolesPermissionsManager } from "./RolesPermissionsManager";
import type { AdminRoleSummary, AdminPermissionSummary } from "@/app/_data/loaders";

const roles: AdminRoleSummary[] = [
  { id: "role-auditor", key: "auditor", name: "Auditor", description: null, isSystem: false },
  { id: "role-super", key: "super_admin", name: "Super Admin", description: null, isSystem: true },
];

const permissions: AdminPermissionSummary[] = [
  { id: "perm-1", key: "finance.read", name: "View finance", description: null },
  { id: "perm-2", key: "audit.read", name: "View audit log", description: null },
  { id: "perm-3", key: "hr.write", name: "Edit HR records", description: null },
];

describe("RolesPermissionsManager (COMP-004: real per-role permissions editor)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Regression test for the bug this page replaced: the old page invented a
  // 9-role x 7-fake-permission-group matrix and saved it to a nonexistent
  // bulk endpoint. This asserts the real per-role read/diff-apply contract:
  // GET the selected role's current permissions, and PATCH only the real,
  // computed diff -- never a fabricated whole-matrix payload.
  it("loads the selected role's real current permissions from the real endpoint, not a hardcoded matrix", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "role-auditor", key: "auditor", name: "Auditor", permissions: ["finance.read", "audit.read"] }), { status: 200 }),
    );

    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: /view audit log/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /edit hr records/i })).not.toBeChecked();

    expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/v1/admin/roles/role-auditor");
  });

  it("saves only the real grant/revoke diff to PATCH .../permissions, never the whole set unconditionally", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/v1/admin/roles/role-auditor") {
        return new Response(JSON.stringify({ id: "role-auditor", permissions: ["finance.read", "audit.read"] }), { status: 200 });
      }
      if (url === "/api/proxy/v1/admin/roles/role-auditor/permissions") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());

    // Revoke finance.read, grant hr.write; audit.read stays as-is.
    fireEvent.click(screen.getByRole("checkbox", { name: /view finance/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /edit hr records/i }));

    const saveButton = await screen.findByRole("button", { name: /save 2 changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));

    const patchCall = fetchSpy.mock.calls.find(([input]) => String(input) === "/api/proxy/v1/admin/roles/role-auditor/permissions");
    expect(patchCall).toBeDefined();
    const init = patchCall![1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as { permissionKeys: string[] };
    expect(new Set(body.permissionKeys)).toEqual(new Set(["audit.read", "hr.write"]));
  });

  // A system role's permissions must never be editable/save-able here --
  // there is no real backend command for it (identity-service RBAC does not
  // support mutating a system role's fixed grant set).
  it("never renders editable checkboxes or a save affordance for a system role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "role-auditor", permissions: [] }), { status: 200 }),
    );

    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);
    fireEvent.change(screen.getByLabelText("Role:"), { target: { value: "role-super" } });

    expect(await screen.findByText(/is a system role/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  // Sabotage check for the honest-failure path: a real upstream 404 (role
  // deleted between list and detail fetch) must render as a visible error,
  // never silently fall back to an empty/fabricated permission set.
  it("shows a real load error instead of silently rendering an empty permission set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "role not found" }), { status: 404 }),
    );

    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/not found|http 404/i);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
