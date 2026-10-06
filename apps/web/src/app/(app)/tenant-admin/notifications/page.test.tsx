import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const getNotificationPreferencesMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getNotificationPreferences: (...a: unknown[]) => getNotificationPreferencesMock(...a),
}));

import NotificationPrefsPage from "./page";

function pref(id: string, label: string, over: Partial<{ emailEnabled: boolean; inAppEnabled: boolean; smsEnabled: boolean; webhookEnabled: boolean }> = {}) {
  return { id, module: "notification", eventType: `evt.${id}`, label, emailEnabled: true, smsEnabled: false, inAppEnabled: true, webhookEnabled: false, ...over };
}

describe("NotificationPrefsPage", () => {
  beforeEach(() => getNotificationPreferencesMock.mockReset());

  // GAP-TENANT-ADMIN-NOTIFICATIONS-04: each event label appears exactly once.
  it("lists each event once (no duplicate left card)", async () => {
    getNotificationPreferencesMock.mockResolvedValue({ data: [pref("p1", "Payment approved")], source: "api" });
    render(await NotificationPrefsPage());
    expect(screen.getAllByText("Payment approved")).toHaveLength(1);
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-03: no "SMS On" KPI; audit link is filtered.
  it("has no 'SMS On' KPI and the audit link is scoped to notification-prefs", async () => {
    getNotificationPreferencesMock.mockResolvedValue({ data: [pref("p1", "A")], source: "api" });
    render(await NotificationPrefsPage());
    expect(screen.queryByText("SMS On")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Audit changes/i })).toHaveAttribute("href", "/tenant-admin/audit?entity=notification-prefs");
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-05: a failed load shows an error + retry, not zeros.
  it("on load error shows a retry state and '—' KPIs, not a zeroed empty page", async () => {
    getNotificationPreferencesMock.mockResolvedValue({ data: [], source: "error" });
    render(await NotificationPrefsPage());
    expect(screen.getByText("Event Types").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // editor not rendered on error
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });
});
