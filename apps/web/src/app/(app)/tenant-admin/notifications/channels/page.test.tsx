import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import NotificationChannelsPage from "./page";

describe("NotificationChannelsPage — GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // CHANNELS-01: the Add form is on the page (no raw API snippet).
  it("renders an Add-channel form and no API snippet / dev copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await NotificationChannelsPage());
    expect(screen.getByRole("form", { name: /add notification channel/i })).toBeInTheDocument();
    // CHANNELS-03/04: no developer snippet
    expect(screen.queryByText(/POST \/api/)).not.toBeInTheDocument();
    expect(screen.queryByText(/yourdomain/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/How to configure/i)).not.toBeInTheDocument();
  });

  // CHANNELS-02: header is "Channel type", no developer parenthetical; type is a label.
  it("shows a clean 'Channel type' header and a human type label", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "c1", name: "Office email", type: "email", isDefault: true, enabled: true }],
      source: "api",
    });
    render(await NotificationChannelsPage());
    const table = screen.getByRole("table");
    expect(within(table).getByText("Channel type")).toBeInTheDocument();
    expect(within(table).queryByText(/Type \(email\/sms\/push\)/)).not.toBeInTheDocument();
    expect(within(table).getByText("Email")).toBeInTheDocument();
    // CHANNELS-05: enabled renders a clear Enabled pill
    expect(within(table).getByText("Enabled")).toBeInTheDocument();
  });

  it("shows the error state on load failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await NotificationChannelsPage());
    expect(screen.getByText(/couldn't load notification channels/i)).toBeInTheDocument();
  });
});
