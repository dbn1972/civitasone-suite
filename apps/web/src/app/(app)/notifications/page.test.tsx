import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// The hub is an async Server Component reading two loaders + session roles.
const getNotificationDeliveries = vi.fn();
const getNotificationExperiments = vi.fn();
const getSessionRoles = vi.fn();

vi.mock("../../_data/loaders", () => ({
  getNotificationDeliveries: () => getNotificationDeliveries(),
  getNotificationExperiments: () => getNotificationExperiments(),
}));

vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => getSessionRoles() };
});

import Page from "./page";

async function renderPage() {
  render(await Page());
}

beforeEach(() => {
  getNotificationDeliveries.mockReset().mockResolvedValue({ data: [], source: "api" });
  getNotificationExperiments.mockReset().mockResolvedValue({ data: [], source: "api" });
  getSessionRoles.mockReset().mockReturnValue([]);
});

describe("Notifications hub (GAP-NOTIFICATIONS-HOME-01 / -04)", () => {
  it("shows a failed-delivery count and an awaiting-approval count", async () => {
    getNotificationDeliveries.mockResolvedValue({
      data: [
        { id: "d1", status: "failed" },
        { id: "d2", status: "bounced" },
        { id: "d3", status: "delivered" },
      ],
      source: "api",
    });
    getNotificationExperiments.mockResolvedValue({
      data: [
        { id: "e1", status: "pending_approval" },
        { id: "e2", status: "running" },
      ],
      source: "api",
    });
    await renderPage();
    const failed = screen.getByText("Failed in recent deliveries").closest(".stat")!;
    expect(failed).toHaveTextContent("2"); // failed + bounced
    const awaiting = screen.getByText("Experiments awaiting approval").closest(".stat")!;
    expect(awaiting).toHaveTextContent("1");
  });

  it("shows '—' for each count when its fetch fails (never a fabricated 0)", async () => {
    getNotificationDeliveries.mockResolvedValue({ data: [], source: "error" });
    getNotificationExperiments.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    const failed = screen.getByText("Failed in recent deliveries").closest(".stat")!;
    expect(failed).toHaveTextContent("—");
    const awaiting = screen.getByText("Experiments awaiting approval").closest(".stat")!;
    expect(awaiting).toHaveTextContent("—");
  });

  it("orders tiles for everyday use: Inbox before A/B Experiments", async () => {
    await renderPage();
    const inbox = screen.getByRole("link", { name: /inbox/i });
    const experiments = screen.getByRole("link", { name: /a\/b experiments/i });
    expect(inbox.compareDocumentPosition(experiments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the Settings tile from a non-admin", async () => {
    getSessionRoles.mockReturnValue(["notification_viewer"]);
    await renderPage();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
  });

  it("shows the Settings tile to a notification admin, linking to channel config", async () => {
    getSessionRoles.mockReturnValue(["tenant_admin"]);
    await renderPage();
    const settings = screen.getByRole("link", { name: /settings/i });
    expect(settings).toHaveAttribute("href", "/tenant-admin/notifications");
  });
});
