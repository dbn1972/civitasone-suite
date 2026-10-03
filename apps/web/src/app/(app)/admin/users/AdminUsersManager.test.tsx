import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminUsersManager } from "./AdminUsersManager";
import type { AdminUserSummary, AdminRoleSummary } from "@/app/_data/loaders";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

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
  const dirState = (over: Partial<NonNullable<Parameters<typeof AdminUsersManager>[0]["directory"]>> = {}) => ({
    total: 1240, counts: { active: 1100, suspended: 100, locked: 0, deactivated: 40 }, page: 2, pageSize: 25, query: "", status: null as null, ...over,
  });
  const tile = (label: string) => Array.from(document.querySelectorAll(".lab")).find((e) => e.textContent === label)!.parentElement!.textContent ?? "";

  it("shows the real total, the window and prev/next links instead of a 200-row cap", () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" directory={dirState()} />);
    expect(screen.getByTestId("users-window")).toHaveTextContent("Showing 26–26 of 1,240");
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/admin/users?page=3");
    expect(tile("Total users")).toContain("1240");
    expect(tile("Suspended")).toContain("100");
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it("the last page has no Next link; the first has no Previous", () => {
    const { unmount } = render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" directory={dirState({ page: 50, total: 1226 })} />);
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
    unmount();
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" directory={dirState({ page: 1 })} />);
    expect(screen.queryByRole("link", { name: /Previous/ })).not.toBeInTheDocument();
  });

  it("search is a GET form that keeps the status filter; the paging links keep the search", () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" directory={dirState({ query: "rao k", status: "suspended", page: 1 })} />);
    const form = screen.getByRole("search", { name: "Search users" });
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("searchbox")).toHaveValue("rao k");
    expect(form.querySelector('input[name="status"]')).toHaveValue("suspended");
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/admin/users?q=rao+k&status=suspended&page=2");
    expect(screen.getByRole("link", { name: "Clear search" })).toHaveAttribute("href", "/admin/users?status=suspended");
    expect(screen.getByTestId("users-window")).toHaveTextContent("matching “rao k”");
  });

  it("a status tab asks the server for that status (so the total stays right)", () => {
    push.mockClear();
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" directory={dirState({ query: "rao", page: 1 })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Suspended" }));
    expect(push).toHaveBeenCalledWith("/admin/users?q=rao&status=suspended");
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(push).toHaveBeenLastCalledWith("/admin/users?q=rao");
  });

  it("suspending moves the tenant-wide counts, not just the page", async () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" currentUserId="u-me" directory={dirState({ page: 1 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "left the department" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    await waitFor(() => expect(tile("Suspended")).toContain("101"));
    expect(tile("Active")).toContain("1099");
  });

  // GAP-ADMIN-USERS-01 (server-side half): say WHY a status change was refused
  it("tells the operator when the server refuses to suspend the last tenant admin", async () => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ code: "LAST_TENANT_ADMIN", message: "internal wording" }), { status: 409 }));
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" currentUserId="u-me" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "left the department" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    expect(await screen.findByText(/last active tenant admin/)).toBeInTheDocument();
    expect(screen.queryByText(/internal wording/)).not.toBeInTheDocument();
    // the row did not change
    expect(screen.getByRole("button", { name: "Suspend" })).toBeInTheDocument();
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

  // GAP-ADMIN-USERS-05
  it("stat tiles move immediately when a user is suspended", async () => {
    render(<AdminUsersManager initialUsers={[other, { ...other, id: "u-3", email: "z@x.gov.in", name: "Zed" }]} roles={roles} source="api" currentUserId="u-me" />);
    const tile = (label: string) => Array.from(document.querySelectorAll(".lab")).find((e) => e.textContent === label)!.parentElement!.textContent ?? "";
    expect(tile("Active")).toContain("2");
    fireEvent.click(screen.getAllByRole("button", { name: "Suspend" })[0]!);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "left the department" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    await waitFor(() => expect(tile("Active")).toContain("1"));
    expect(tile("Suspended")).toContain("1");
  });

  // GAP-ADMIN-USERS-06
  it("export is confirmed, audited first, and the CSV is quoted + formula-safe", async () => {
    let blobText = "";
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: () => "" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => {} });
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { const fr = new FileReader(); fr.onload = () => { blobText = String(fr.result); }; fr.readAsText(b as Blob); return "blob:x"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const bad = { ...other, id: "u-4", name: "=cmd|x, Evil", email: "e@x.gov.in" };
    render(<AdminUsersManager initialUsers={[bad]} roles={roles} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText(/personal data/)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("user-exports/audit"))).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Export CSV" }).at(-1)!);
    await waitFor(() => expect(blobText).toContain("Evil"));
    const audit = fetchSpy.mock.calls.filter(([u]) => String(u).includes("/api/proxy/v1/admin/user-exports/audit"));
    expect(audit).toHaveLength(1);
    expect(JSON.parse((audit[0]![1] as RequestInit).body as string)).toMatchObject({ rowCount: 1 });
    expect(blobText).toContain(`"'=cmd|x, Evil"`);
  });

  it("no file is created when the audit record cannot be written", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: () => "" });
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:x");
    fetchSpy.mockImplementation(async () => new Response("{}", { status: 500 }));
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Export CSV" })).at(-1)!);
    expect(await screen.findByText(/no file was created/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  // GAP-ADMIN-USERS-07
  it("status filter supports arrow keys (roving tabs)", () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" />);
    const all = screen.getByRole("tab", { name: "All" });
    fireEvent.keyDown(all, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
  });

  it("Edit Roles sheet: Esc closes it and focus returns to the opener; Reset Password explained without hover", async () => {
    render(<AdminUsersManager initialUsers={[other]} roles={roles} source="api" />);
    expect(screen.getByText(/managed in the Keycloak Admin console/)).toBeVisible();
    const opener = screen.getByRole("button", { name: "Edit Roles" });
    opener.focus();
    fireEvent.click(opener);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
