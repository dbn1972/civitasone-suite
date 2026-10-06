import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { NotificationPrefActions } from "./NotificationPrefActions";

function pref(id: string, label: string, over: Partial<{ emailEnabled: boolean; inAppEnabled: boolean; smsEnabled: boolean; webhookEnabled: boolean }> = {}) {
  return {
    id,
    module: "notification",
    eventType: `evt.${id}`,
    label,
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    webhookEnabled: false,
    ...over,
  };
}

describe("NotificationPrefActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // UX-016 (regression): clerk-safe error, never raw body.
  it("shows a clerk-safe message, never the raw response body, when saving fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("prefs-service unavailable: ECONNREFUSED", { status: 503 }));
    render(<NotificationPrefActions prefs={[pref("p1", "Payment approved")]} />);
    fireEvent.click(screen.getByRole("switch", { name: /Email for Payment approved/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/ECONNREFUSED/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b503\b/);
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-02: partial failure is reported honestly and
  // the saved rows are reconciled (router.refresh called).
  it("reports 'Saved X of Y' and 'N not saved' when the 2nd of 3 PATCHes fails", async () => {
    let n = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      n += 1;
      return n === 2 ? new Response("boom", { status: 500 }) : new Response(null, { status: 202 });
    });
    render(<NotificationPrefActions prefs={[pref("p1", "A"), pref("p2", "B"), pref("p3", "C")]} />);
    // make all three dirty by toggling Email off
    fireEvent.click(screen.getByRole("switch", { name: /Email for A/i }));
    fireEvent.click(screen.getByRole("switch", { name: /Email for B/i }));
    fireEvent.click(screen.getByRole("switch", { name: /Email for C/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Saved 2 of 3/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/1 not saved: B/i);
    // reconcile the saved rows with the server
    expect(refreshMock).toHaveBeenCalled();
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-01: Reset no longer PATCHes on click; it
  // opens a confirm dialog. Cancel issues no fetch.
  it("Reset opens a confirm dialog and Cancel sends no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NotificationPrefActions prefs={[pref("p1", "A", { emailEnabled: false })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-01: confirming Reset only STAGES defaults
  // (no fetch); the admin must then press Save.
  it("confirming Reset stages defaults without any PATCH", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NotificationPrefActions prefs={[pref("p1", "A", { emailEnabled: false, inAppEnabled: false })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    fireEvent.click(screen.getByRole("button", { name: /stage defaults/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Defaults staged/i));
    // the Email switch for A is now ON (staged default)
    expect(screen.getByRole("switch", { name: /Email for A/i })).toHaveAttribute("aria-checked", "true");
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-05: re-rendering with a brand-new pref id
  // must not throw (pending had no entry for it).
  it("does not crash when a new pref id appears after a refresh", () => {
    const { rerender } = render(<NotificationPrefActions prefs={[pref("p1", "A")]} />);
    expect(() =>
      rerender(<NotificationPrefActions prefs={[pref("p1", "A"), pref("p2", "NEW", { emailEnabled: false })]} />),
    ).not.toThrow();
    expect(screen.getByRole("switch", { name: /Email for NEW/i })).toHaveAttribute("aria-checked", "false");
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-03: SMS/Webhook shown read-only, not as toggles.
  it("labels SMS/Webhook as read-only, not interactive switches", () => {
    render(<NotificationPrefActions prefs={[pref("p1", "A", { smsEnabled: true, webhookEnabled: true })]} />);
    expect(screen.getByText(/SMS \(read-only\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Webhook \(read-only\)/i)).toBeInTheDocument();
    // no switch role for SMS/Webhook
    expect(screen.queryByRole("switch", { name: /SMS/i })).not.toBeInTheDocument();
  });
});
