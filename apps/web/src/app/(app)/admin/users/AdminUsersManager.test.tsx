import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminUsersManager } from "./AdminUsersManager";
import type { AdminUserSummary, AdminRoleSummary } from "@/app/_data/loaders";

const me: AdminUserSummary = { id: "u-me", email: "me@x.gov.in", name: "Me Admin", empCode: null, status: "active", mfaEnabled: true };
const other: AdminUserSummary = { id: "u-other", email: "o@x.gov.in", name: "Olive Other", empCode: null, status: "active", mfaEnabled: false };
const roles: AdminRoleSummary[] = [
  { id: "r1", key: "auditor", name: "Auditor", description: null, isSystem: false },
  { id: "r2", key: "super_admin", name: "Super Admin", description: null, isSystem: true },
];

describe("AdminUsersManager", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });
  const patches = () => fetchSpy.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.method) === "PATCH");

  // GAP-ADMIN-USERS-01
  it("Suspend asks for a reason first and sends nothing until confirmed", async () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" currentUserId="u-me" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByText(/Suspend Olive Other\?/)).toBeInTheDocument();
    expect(patches()).toHaveLength(0);
    const confirm = screen.getByRole("button", { name: "Suspend user" });
    expect(confirm).toBeDisabled(); // reason required
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "left the department" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(patches()).toHaveLength(1));
    const body = JSON.parse((patches()[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ status: "suspended", reason: "left the department" });
  });

  it("Cancel makes no request", async () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" currentUserId="u-me" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(patches()).toHaveLength(0);
  });

  it("an admin cannot suspend their own row", () => {
    render(<AdminUsersManager initialUsers={[me]} roles={roles} source="api" currentUserId="u-me" />);
    expect(screen.getByRole("button", { name: "Suspend" })).toBeDisabled();
  });

  // GAP-ADMIN-USERS-03
  it("shows the truncation notice when the directory may hold more users", () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" truncatedAt={200} />);
    expect(screen.getByText(/Showing the first 200 users only/)).toBeInTheDocument();
  });
  it("shows no notice for a complete directory", () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" />);
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  // GAP-ADMIN-USERS-02
  it("a tenant admin cannot tick platform roles in Edit Roles, and a held one is preserved", async () => {
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/user-roles/") && !(init as RequestInit | undefined)?.method) return new Response(JSON.stringify({ data: [{ key: "super_admin" }] }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" canAssignPlatformRoles={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Roles" }));
    const superBox = await screen.findByRole("checkbox", { name: /Super Admin/ });
    await waitFor(() => expect(superBox).toBeChecked());
    expect(superBox).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Auditor/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));
    // confirm dialog lists the diff; nothing sent yet
    expect(await screen.findByText(/Grant:/)).toBeInTheDocument();
    expect(patches()).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Save roles" }).at(-1)!);
    await waitFor(() => expect(patches()).toHaveLength(1));
    const body = JSON.parse((patches()[0]![1] as RequestInit).body as string);
    expect(new Set(body.roleKeys)).toEqual(new Set(["super_admin", "auditor"]));
  });

  it("a platform admin can tick platform roles", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" canAssignPlatformRoles />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Roles" }));
    const superBox = await screen.findByRole("checkbox", { name: /Super Admin/ });
    await waitFor(() => expect(superBox).not.toBeDisabled());
  });
});
