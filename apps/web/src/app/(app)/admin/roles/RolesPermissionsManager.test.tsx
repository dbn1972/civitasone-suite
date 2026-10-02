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

    // GAP-ADMIN-ROLES-02: nothing is sent until the diff is confirmed.
    const confirmBtn = await screen.findByRole("button", { name: /apply changes/i });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith("/permissions"))).toBe(false);
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));

    const patchCall = fetchSpy.mock.calls.find(([input]) => String(input) === "/api/proxy/v1/admin/roles/role-auditor/permissions");
    expect(patchCall).toBeDefined();
    const init = patchCall![1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as { permissionKeys: string[] };
    expect(new Set(body.permissionKeys)).toEqual(new Set(["audit.read", "hr.write"]));
  });

  // A system role's permissions must never be editable/save-able here --
  // there is no real backend command for it. GAP-ADMIN-ROLES-05: they ARE
  // shown, read-only, so a reviewer can see what a privileged role holds.
  it("shows a system role's permissions as disabled checkboxes with Save disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: "role-super", permissions: ["finance.read"] }), { status: 200 }),
    );

    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);
    fireEvent.change(screen.getByLabelText("Role:"), { target: { value: "role-super" } });

    expect(await screen.findByText(/is a system role/i)).toBeInTheDocument();
    const box = await screen.findByRole("checkbox", { name: /view finance/i });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /edit hr records/i })).toBeDisabled();
    fireEvent.click(box);
    expect(screen.queryByText(/unsaved change/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("a failed read for a system role shows the load error, not a fake empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);
    fireEvent.change(screen.getByLabelText("Role:"), { target: { value: "role-super" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // Sabotage check for the honest-failure path: a real upstream 404 (role
  // deleted between list and detail fetch) must render as a visible error,
  // never silently fall back to an empty/fabricated permission set.
  //
  // UX-016: this used to assert the raw backend `message` ("role not
  // found") or the raw HTTP status ("HTTP 404") appeared in the alert --
  // the same class of leak useFormError/toHumanError closes fleet-wide
  // (UX-003). The clerk-safe replacement never shows backend-authored text
  // or the status code, so this now asserts a catalogued message instead,
  // and explicitly that the raw text/status are absent.
  it("shows a clerk-safe load error instead of silently rendering an empty permission set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "role not found" }), { status: 404 }),
    );

    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't load/i));
    expect(alert.textContent).not.toMatch(/role not found/i);
    expect(alert.textContent).not.toMatch(/\b404\b/);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("RolesPermissionsManager - diff preview and partial saves (GAP-ADMIN-ROLES-02)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("the confirm dialog lists exactly what will be granted and revoked", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "role-auditor", permissions: ["finance.read"] }), { status: 200 }),
    );
    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    fireEvent.click(screen.getByRole("checkbox", { name: /view finance/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /edit hr records/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save 2 changes/i }));
    expect(await screen.findByText(/Grant \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Revoke \(1\)/)).toBeInTheDocument();
  });

  it("a 207 partial result is reported as a failure, never as 'Saved.'", async () => {
    let reads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/permissions")) {
        return new Response(JSON.stringify({ status: "partial", granted: [], revoked: [], skipped: [], failed: [{ key: "hr.write", action: "grant", status: 403, code: "FORBIDDEN", message: "x" }] }), { status: 207 });
      }
      reads++;
      return new Response(JSON.stringify({ id: "role-auditor", permissions: ["finance.read"] }), { status: 200 });
    });
    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    fireEvent.click(screen.getByRole("checkbox", { name: /edit hr records/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save 1 change/i }));
    fireEvent.click(await screen.findByRole("button", { name: /apply changes/i }));
    const alert = await screen.findByText(/could not be applied/i);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
    // the role was re-read so the checkbox shows the real (unchanged) state
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /edit hr records/i })).not.toBeChecked());
  });
});

describe("RolesPermissionsManager - unsaved edits, counts, grouping (GAP-ADMIN-ROLES-03/04/06)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  const threeRoles: AdminRoleSummary[] = [
    ...roles,
    { id: "role-clerk", key: "clerk", name: "Clerk", description: null, isSystem: false },
  ];
  function mockRoleGet() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const perms = url.endsWith("role-clerk") ? ["hr.write"] : ["finance.read", "audit.read"];
      return new Response(JSON.stringify({ permissions: perms }), { status: 200 });
    });
  }

  it("asks before dropping unsaved toggles on a role switch; Cancel keeps role and toggle", async () => {
    mockRoleGet();
    render(<RolesPermissionsManager roles={threeRoles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    fireEvent.click(screen.getByRole("checkbox", { name: /edit hr records/i }));
    fireEvent.change(screen.getByLabelText("Role:"), { target: { value: "role-clerk" } });
    expect(await screen.findByText(/discard 1 unsaved change/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect((screen.getByLabelText("Role:") as HTMLSelectElement).value).toBe("role-auditor");
    expect(screen.getByRole("checkbox", { name: /edit hr records/i })).toBeChecked();
  });

  it("Confirm switches role and loads its permissions; no dialog when nothing changed", async () => {
    mockRoleGet();
    render(<RolesPermissionsManager roles={threeRoles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    // nothing changed -> straight switch
    fireEvent.change(screen.getByLabelText("Role:"), { target: { value: "role-clerk" } });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /edit hr records/i })).toBeChecked());
    expect(screen.queryByText(/unsaved change/i)).not.toBeInTheDocument();
    // with an edit -> dialog -> confirm
    fireEvent.click(screen.getByRole("checkbox", { name: /view audit log/i }));
    fireEvent.change(screen.getByLabelText("Role:"), { target: { value: "role-auditor" } });
    fireEvent.click(await screen.findByRole("button", { name: /discard and switch/i }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    expect(screen.queryByText(/\+\d unsaved/i)).not.toBeInTheDocument();
  });

  it("registers a beforeunload guard only while there are unsaved changes", async () => {
    mockRoleGet();
    const add = vi.spyOn(window, "addEventListener");
    render(<RolesPermissionsManager roles={threeRoles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    expect(add.mock.calls.some(([t]) => t === "beforeunload")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /edit hr records/i }));
    expect(add.mock.calls.some(([t]) => t === "beforeunload")).toBe(true);
  });

  it("'Granted to selected role' stays at the saved count; unsaved toggles are shown separately", async () => {
    mockRoleGet();
    render(<RolesPermissionsManager roles={threeRoles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    const card = () => screen.getByText("Granted to selected role").parentElement as HTMLElement;
    expect(card()).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("checkbox", { name: /edit hr records/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /view audit log/i }));
    expect(card()).toHaveTextContent("2");
    expect(screen.getByText(/\+2 unsaved changes/i)).toBeInTheDocument();
  });

  it("warns when a full page of permissions suggests truncation and relabels the card", async () => {
    mockRoleGet();
    const many: AdminPermissionSummary[] = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, key: `mod${i % 5}.perm${i}`, name: `Perm ${i}`, description: null }));
    render(<RolesPermissionsManager roles={threeRoles} permissions={many} source="api" />);
    expect(await screen.findByText(/showing the first 200 permissions/i)).toBeInTheDocument();
    expect(screen.getByText("Loaded permissions")).toBeInTheDocument();
  });

  it("groups by prefix and filters without dropping hidden checked keys from the PATCH", async () => {
    const spy = mockRoleGet();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/permissions")) return new Response("{}", { status: 200 });
      void init;
      return new Response(JSON.stringify({ permissions: ["finance.read"] }), { status: 200 });
    });
    render(<RolesPermissionsManager roles={threeRoles} permissions={permissions} source="api" />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /view finance/i })).toBeChecked());
    expect(screen.getAllByRole("group").length).toBe(3);
    fireEvent.change(screen.getByLabelText(/filter permissions/i), { target: { value: "hr" } });
    expect(screen.queryByRole("checkbox", { name: /view finance/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /edit hr records/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save 1 change/i }));
    fireEvent.click(await screen.findByRole("button", { name: /apply changes/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/saved/i));
    const patch = spy.mock.calls.find(([i]) => String(i).endsWith("/permissions"))!;
    const body = JSON.parse((patch[1] as RequestInit).body as string) as { permissionKeys: string[] };
    expect(new Set(body.permissionKeys)).toEqual(new Set(["finance.read", "hr.write"]));
  });
});

describe("RolesPermissionsManager - initial selection and loading tile", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("selects the first role when every role is a system role, so it is viewable without a manual switch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ permissions: ["finance.read"] }), { status: 200 }));
    render(<RolesPermissionsManager roles={[roles[1]]} permissions={permissions} source="api" />);
    expect(await screen.findByText(/is a system role/i)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/v1/admin/roles/role-super");
  });

  it("'Granted to selected role' shows a dash while a role is still loading", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
    render(<RolesPermissionsManager roles={roles} permissions={permissions} source="api" />);
    expect((screen.getByText("Granted to selected role").parentElement as HTMLElement)).toHaveTextContent("—");
  });
});
