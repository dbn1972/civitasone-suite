import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RolesTable } from "./RolesTable";

function openDialogAndFill(name: string, reason: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ New Role" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText(/Role name/i), { target: { value: name } });
  // GAP-TENANT-ADMIN-ROLES-02: a reason is now required before Create enables.
  fireEvent.change(within(dialog).getByLabelText(/Reason for creating this role/i), { target: { value: reason } });
  return dialog;
}

describe("RolesTable (NewRoleDialog) — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when creating a role fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("role name already exists in this tenant", { status: 409 }),
    );

    render(<RolesTable roles={[]} />);
    const dialog = openDialogAndFill("Finance Reviewer", "Needed for voucher review");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create role" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/This role was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(dialog.textContent).not.toMatch(/already exists/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });
});

describe("RolesTable — GAP-TENANT-ADMIN-ROLES-02 (reason required + sent in body)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("disables Create until a reason is entered", () => {
    render(<RolesTable roles={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New Role" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Role name/i), { target: { value: "Auditor" } });
    expect(within(dialog).getByRole("button", { name: "Create role" })).toBeDisabled();
  });

  it("sends the reason in the POST body (not as a header)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<RolesTable roles={[]} />);
    const dialog = openDialogAndFill("Auditor", "Quarterly audit access");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create role" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ name: "Auditor", reason: "Quarterly audit access" });
  });
});

describe("RolesTable — GAP-TENANT-ADMIN-ROLES-04 (canCreate gating)", () => {
  it("hides the New Role button for a view-only admin", () => {
    render(<RolesTable roles={[]} canCreate={false} />);
    expect(screen.queryByRole("button", { name: "+ New Role" })).toBeNull();
  });

  it("shows the New Role button when canCreate", () => {
    render(<RolesTable roles={[]} canCreate />);
    expect(screen.getByRole("button", { name: "+ New Role" })).toBeInTheDocument();
  });
});

describe("RolesTable — GAP-TENANT-ADMIN-ROLES-05 (full description via title)", () => {
  it("exposes the full description as a title tooltip on the clipped cell", () => {
    const long = "A very long role description that is clipped to 200px with ellipsis in the table cell";
    render(<RolesTable roles={[{ id: "r1", name: "Reviewer", description: long, isSystemRole: false, userCount: 0 }]} />);
    expect(screen.getByText(long)).toHaveAttribute("title", long);
  });
});
