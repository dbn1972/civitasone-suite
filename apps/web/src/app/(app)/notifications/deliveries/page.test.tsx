import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

type OfflineState = {
  data: unknown[];
  source: string;
  offline: boolean;
  cachedAt: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

let offlineState: OfflineState;

vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => offlineState,
}));

import NotificationDeliveriesPage from "./page";

function row(over: Record<string, unknown>) {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    notificationTitle: "Payslip ready",
    recipient: "asha@example.gov.in",
    channel: "email",
    attemptCount: 1,
    deliveredAt: "2026-10-01T04:30:00.000Z",
    status: "delivered",
    ...over,
  };
}

function setState(over: Partial<OfflineState>) {
  offlineState = {
    data: [],
    source: "live",
    offline: false,
    cachedAt: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
    ...over,
  };
}

describe("NotificationDeliveriesPage", () => {
  beforeEach(() => setState({}));

  // DELIVERIES-01: recipient printed masked, never the clear value.
  it("masks the recipient in the delivery log", () => {
    setState({ data: [row({ id: "d-1", recipient: "asha@example.gov.in", status: "delivered" })] });
    render(<NotificationDeliveriesPage />);
    expect(screen.queryByText("asha@example.gov.in")).not.toBeInTheDocument();
    // first local char is kept, rest masked
    expect(screen.getByText(/a\*+@/)).toBeInTheDocument();
  });

  // DELIVERIES-02: tiles sum to Total, bounced/queued/sent land in a group.
  it("groups statuses so the tiles sum to Total", () => {
    setState({
      data: [
        row({ id: "d-1", status: "delivered" }),
        row({ id: "d-2", status: "sent" }),
        row({ id: "d-3", status: "queued" }),
        row({ id: "d-4", status: "pending" }),
        row({ id: "d-5", status: "failed" }),
        row({ id: "d-6", status: "bounced" }),
      ],
    });
    render(<NotificationDeliveriesPage />);
    const grid = document.querySelector(".grid.g-4") as HTMLElement;
    const tile = (label: string) => {
      const lab = within(grid).getByText(label);
      return lab.parentElement as HTMLElement; // .stat wrapper holds .lab + .val
    };
    // delivered = delivered|sent = 2; pending = pending|queued = 2; failed = failed|bounced = 2
    expect(tile("Total")).toHaveTextContent("6");
    expect(tile("Delivered")).toHaveTextContent("2");
    expect(tile("Pending")).toHaveTextContent("2");
    expect(tile("Failed")).toHaveTextContent("2");
  });

  // DELIVERIES-04: while loading, tiles show "—" not a fabricated 0.
  it("shows '—' in the tiles while loading", () => {
    setState({ loading: true, data: [] });
    render(<NotificationDeliveriesPage />);
    const grid = document.querySelector(".grid.g-4") as HTMLElement;
    expect(within(grid).getByText("Total").parentElement).toHaveTextContent("—");
    expect(within(grid).getByText("Delivered").parentElement).toHaveTextContent("—");
  });

  // DELIVERIES-04: on error, tiles show "—" not 0.
  it("shows '—' in the tiles on error", () => {
    setState({ error: "boom", data: [] });
    render(<NotificationDeliveriesPage />);
    const grid = document.querySelector(".grid.g-4") as HTMLElement;
    expect(within(grid).getByText("Total").parentElement).toHaveTextContent("—");
  });

  // DELIVERIES-05: header links back to the module hub and offers Send + Templates.
  it("links back to the hub and offers Send + Templates actions", () => {
    setState({ data: [row({ id: "d-1" })] });
    render(<NotificationDeliveriesPage />);
    expect(screen.getByRole("link", { name: /send notification/i })).toHaveAttribute("href", "/notifications/compose");
    expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute("href", "/notifications/templates");
    const back = screen.getByRole("link", { name: "Notifications" });
    expect(back).toHaveAttribute("href", "/notifications");
  });
});
