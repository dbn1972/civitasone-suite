import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { UserSecurityActions } from "./UserSecurityActions";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("UserSecurityActions — GAP-TENANT-ADMIN-USERS-DETAIL-01 (confirm + reason)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT call fetch until a reason is confirmed; the request body carries the reason", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    renderWithToast(<UserSecurityActions userId="u-1" email="asha@gov.in" activeSessionCount={3} status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    // dialog open, no fetch yet
    const dialog = await screen.findByRole("alertdialog");
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "offboarding per HR ticket 42" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send reset link" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/identity/users/u-1/reset-password");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ reason: "offboarding per HR ticket 42" });
  });

  it("Cancel makes no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    renderWithToast(<UserSecurityActions userId="u-1" email="asha@gov.in" activeSessionCount={3} status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GAP-TENANT-ADMIN-USERS-DETAIL-05: Revoke all is disabled when the user has no active sessions", () => {
    renderWithToast(<UserSecurityActions userId="u-1" email="asha@gov.in" activeSessionCount={0} status="active" />);
    expect(screen.getByRole("button", { name: "Revoke all sessions" })).toBeDisabled();
  });

  it("shows a clerk-safe message, never the raw response body, when reset-password fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("identity-service: user not found in realm", { status: 404 }),
    );

    renderWithToast(<UserSecurityActions userId="u-1" email="asha@gov.in" activeSessionCount={2} status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "some reason here" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send reset link" }));

    await waitFor(() => expect(dialog.textContent).not.toMatch(/user not found in realm/i));
    expect(dialog.textContent).not.toMatch(/\b404\b/);
  });

  it("GAP-TENANT-ADMIN-USERS-05/DETAIL-03: Suspend requires a reason and PATCHes the status route; Reactivate is shown for a suspended user", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    const { unmount } = renderWithToast(<UserSecurityActions userId="u-1" email="asha@gov.in" activeSessionCount={1} status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "policy violation" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend user" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/identity/users/u-1/status");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ status: "suspended", reason: "policy violation" });
    unmount();

    // A suspended user shows "Reactivate" instead of "Suspend".
    renderWithToast(<UserSecurityActions userId="u-2" email="b@gov.in" activeSessionCount={0} status="suspended" />);
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
  });
});
