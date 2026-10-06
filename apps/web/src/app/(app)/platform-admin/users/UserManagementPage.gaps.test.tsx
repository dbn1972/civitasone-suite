import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, seed: unknown) => ({ data: seed }),
}));

import { UserManagementPage, buildCsv } from "./UserManagementPage";

type U = {
  id: string; name?: string | null; email: string; roles: string[]; status: string;
  mfaEnabled: boolean; lastLoginAt?: string | null; department?: string | null;
};

const ASHA: U = { id: "a1", name: "Asha Rao", email: "asha@example.gov.in", roles: ["tenant_admin"], status: "active", mfaEnabled: true, lastLoginAt: null, department: "Revenue" };
const SA1: U = { id: "sa1", name: "Admin One", email: "sa1@example.gov.in", roles: ["super_admin"], status: "active", mfaEnabled: true, lastLoginAt: null };
const PENDING: U = { id: "p1", name: "Pending Person", email: "pending@example.gov.in", roles: [], status: "pending", mfaEnabled: false, lastLoginAt: null };

function mockFetch(status: number, body: unknown = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; },
  }) as unknown as typeof fetch;
}

describe("UserManagementPage gaps (USERS-01/02/03/05/06/07)", () => {
  beforeEach(() => { vi.clearAllMocks(); refreshMock.mockReset(); });

  // USERS-07
  it("renders a non-active status as a humanized pill, not raw lowercase", () => {
    const { container } = render(<UserManagementPage users={[PENDING]} />);
    const pills = Array.from(container.querySelectorAll("td .pill")).map((p) => p.textContent);
    expect(pills).toContain("Pending");
    expect(pills).not.toContain("pending");
  });

  it("renames the Department column header (not 'Dept')", () => {
    render(<UserManagementPage users={[ASHA]} currentUserRoles={["platform_admin"]} />);
    expect(screen.getByRole("columnheader", { name: "Department" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Dept" })).not.toBeInTheDocument();
  });

  // USERS-01: export hidden for non-full-access and PII masked.
  it("hides Export controls and masks email for a non-full-access viewer", () => {
    render(<UserManagementPage users={[ASHA]} currentUserRoles={["tenant_admin"]} />);
    expect(screen.queryByRole("button", { name: /Export all/ })).not.toBeInTheDocument();
    expect(screen.queryByText("asha@example.gov.in")).not.toBeInTheDocument();
    expect(screen.getByText(maskEmailExpected("asha@example.gov.in"))).toBeInTheDocument();
  });

  it("shows Export and the clear email for a platform admin", () => {
    render(<UserManagementPage users={[ASHA]} currentUserRoles={["platform_admin"]} />);
    expect(screen.getByRole("button", { name: /Export all/ })).toBeInTheDocument();
    expect(screen.getByText("asha@example.gov.in")).toBeInTheDocument();
  });

  // USERS-01: export routes through the audit endpoint BEFORE downloading.
  it("records an audit event via the server before exporting", async () => {
    mockFetch(202);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    global.URL.createObjectURL = vi.fn(() => "blob:x");
    global.URL.revokeObjectURL = vi.fn();
    render(<UserManagementPage users={[ASHA]} currentUserRoles={["platform_admin"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Export all/ }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/admin/user-exports/audit",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const init = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.rowCount).toBe(1);
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    clickSpy.mockRestore();
  });

  // USERS-03: self-suspend + last-super-admin guard disable the Suspend control.
  it("disables Suspend on the signed-in admin's own row", () => {
    render(<UserManagementPage users={[ASHA]} currentUserId="a1" />);
    expect(screen.getByRole("button", { name: "Suspend" })).toBeDisabled();
  });

  it("disables Suspend on the last active super admin", () => {
    render(<UserManagementPage users={[SA1]} currentUserId="other" />);
    expect(screen.getByRole("button", { name: "Suspend" })).toBeDisabled();
  });

  it("blocks Confirm until a long-enough reason is entered", () => {
    render(<UserManagementPage users={[ASHA]} currentUserId="other" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    const confirm = screen.getByRole("button", { name: "Suspend user" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for suspension"), { target: { value: "ok" } });
    expect(confirm).toBeDisabled(); // below min length
    fireEvent.change(screen.getByLabelText("Reason for suspension"), { target: { value: "Genuine reason" } });
    expect(confirm).not.toBeDisabled();
  });

  // USERS-03: a suspended row offers Reactivate, which PATCHes status=active.
  it("offers Reactivate for a suspended user and PATCHes status active", async () => {
    mockFetch(202);
    const suspended: U = { ...ASHA, status: "suspended" };
    render(<UserManagementPage users={[suspended]} currentUserId="other" />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    fireEvent.click(screen.getByRole("button", { name: "Reactivate user" }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/proxy/v1/admin/users/${suspended.id}/status`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "active" }) }),
      ),
    );
  });

  // USERS-02: a failed suspend does not leak into the reset dialog.
  it("does not show the suspend error inside the reset dialog", async () => {
    mockFetch(500, { code: "X", message: "boom" });
    render(<UserManagementPage users={[ASHA]} currentUserId="other" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    fireEvent.change(screen.getByLabelText("Reason for suspension"), { target: { value: "Genuine reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    expect(await screen.findByText(/could not suspend user/i)).toBeInTheDocument();
    // Cancel suspend, open reset: no stale suspend error.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(screen.queryByText(/could not suspend user/i)).not.toBeInTheDocument();
  });

  // USERS-05: role filter options come from the catalogue, not a hard-coded list.
  it("drives the role filter from the provided catalogue", () => {
    render(<UserManagementPage users={[ASHA]} roleOptions={["revenue_officer", "ward_clerk"]} />);
    const select = screen.getByLabelText("Filter by role");
    expect(within(select).getByRole("option", { name: "revenue officer" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "ward clerk" })).toBeInTheDocument();
    // The old hard-coded "payroll_admin" option is gone.
    expect(within(select).queryByRole("option", { name: "payroll admin" })).not.toBeInTheDocument();
  });

  // USERS-06: a Clear selection control appears and clears the set.
  it("offers Clear selection once rows are selected", () => {
    render(<UserManagementPage users={[ASHA, PENDING]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Asha Rao" }));
    expect(screen.getByText(/1 selected \(across pages\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/selected \(across pages\)/)).not.toBeInTheDocument();
  });
});

// USERS-01: CSV formula injection is neutralised.
describe("CSV export hardening (USERS-01)", () => {
  it("prefixes a formula-leading cell with an apostrophe", () => {
    const csv = buildCsv([
      { id: "x", name: "=HYPERLINK(\"http://evil\")", email: "a@b.gov.in", roles: ["r"], status: "active", mfaEnabled: false, lastLoginAt: null, department: "+2+3" },
    ]);
    expect(csv).toContain("\"'=HYPERLINK");
    expect(csv).toContain("\"'+2+3\"");
  });
});

// Local re-implementation of the component's maskEmail expectation.
import { maskEmail } from "@/app/_components/ds/Masked";
function maskEmailExpected(v: string): string { return maskEmail(v); }
