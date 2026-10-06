import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NotificationItem } from "@civitasone/types";

const resource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => resource(),
}));

import NotificationsListPage from "./page";

function item(partial: Record<string, unknown>): NotificationItem {
  const base = {
    id: "n1", title: "T", message: "", module: "notification", eventType: "email",
    recipient: "asha@example.gov.in", channel: "email", status: "sent",
    createdAt: "2026-01-15T19:00:00.000Z",
  };
  // The runtime classifier handles delivered/queued/bounced etc.; the typed
  // NotificationItem union is narrower, so build loosely and cast once.
  return { ...base, ...partial } as NotificationItem;
}

function base(over: Record<string, unknown>) {
  return {
    data: [], source: "live", offline: false, cachedAt: null,
    loading: false, revalidating: false, error: null, refresh: vi.fn(),
    ...over,
  };
}

describe("NotificationsListPage", () => {
  beforeEach(() => resource.mockReset());

  it("LIST-01: masks the recipient instead of printing it verbatim", () => {
    resource.mockReturnValue(base({ data: [item({ recipient: "asha@example.gov.in" })] }));
    render(<NotificationsListPage />);
    expect(screen.queryByText("asha@example.gov.in")).not.toBeInTheDocument();
    expect(screen.getByText(/a\*\*\*@e\*\*\*/)).toBeInTheDocument();
  });

  it("LIST-02: failed events do not count as Unread and tiles sum to Total", () => {
    const data = [
      item({ id: "a", status: "sent" }),
      item({ id: "b", status: "failed" }),
      item({ id: "c", status: "queued" }),
      item({ id: "d", status: "read" }),
      item({ id: "e", status: "delivered" }),
    ];
    resource.mockReturnValue(base({ data }));
    const { container } = render(<NotificationsListPage />);
    // Scope to the stat tiles (the "Failed" tab in Segmented also has that text).
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const tileFor = (label: string) => tiles.find((t) => t.querySelector(".lab")?.textContent === label)!;
    // delivered bucket = sent + delivered + read = 3; failed = 1; inProgress (queued) = 1; total 5.
    expect(tileFor("Total").textContent).toContain("5");
    expect(tileFor("Failed").textContent).toContain("1");
    expect(tileFor("In progress").textContent).toContain("1");
    expect(tileFor("Delivered").textContent).toContain("3");
  });

  it("LIST-03: shows '—' in stat tiles while loading, not a fabricated 0", () => {
    resource.mockReturnValue(base({ data: [], loading: true }));
    render(<NotificationsListPage />);
    const total = screen.getByText("Total").closest(".stat")!;
    expect(total.textContent).toContain("—");
    expect(total.textContent).not.toMatch(/\b0\b/);
  });

  it("LIST-04: renders the DataSourceBadge saved-data note when serving cache", () => {
    resource.mockReturnValue(base({ data: [item({})], source: "cache", cachedAt: "2026-01-10T00:00:00.000Z" }));
    render(<NotificationsListPage />);
    expect(screen.getByText(/showing saved data/i)).toBeInTheDocument();
  });

  it("LIST-05: shows date AND time for recent events", () => {
    resource.mockReturnValue(base({ data: [item({ createdAt: "2026-01-15T19:00:00.000Z" })] }));
    render(<NotificationsListPage />);
    // formatIndianDateTime renders "16 Jan 2026, 12:30 am" (IST). Time present.
    expect(screen.getByText(/16 Jan 2026,/)).toBeInTheDocument();
  });
});
