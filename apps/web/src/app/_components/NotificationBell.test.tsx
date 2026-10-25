import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationBell, notificationActionUrl, type Notification } from "./NotificationBell";

describe("NotificationBell", () => {
  const notifications: Notification[] = [
    { id: "1", title: "Budget approved", time: "5 min ago", read: false, icon: "✅" },
    { id: "2", title: "Payment sent", description: "₹1,00,000", time: "1 hr ago", read: true, icon: "💳" },
  ];

  it("renders bell button", () => {
    render(<NotificationBell notifications={notifications} />);
    expect(screen.getByTitle("Notifications")).toBeInTheDocument();
  });

  it("shows unread count badge", () => {
    render(<NotificationBell notifications={notifications} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("accepts explicit unreadCount prop", () => {
    render(<NotificationBell notifications={notifications} unreadCount={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not show badge when count is 0", () => {
    const allRead: Notification[] = [{ id: "1", title: "Read", time: "now", read: true }];
    render(<NotificationBell notifications={allRead} />);
    // Button only has bell emoji, no count badge
    const button = screen.getByTitle("Notifications");
    expect(button.querySelector("span")).toBeNull();
  });

  it("opens dropdown on click", () => {
    render(<NotificationBell notifications={notifications} />);
    fireEvent.click(screen.getByTitle("Notifications"));
    expect(screen.getByText("Budget approved")).toBeInTheDocument();
    expect(screen.getByText("Payment sent")).toBeInTheDocument();
  });

  it("shows notification descriptions", () => {
    render(<NotificationBell notifications={notifications} />);
    fireEvent.click(screen.getByTitle("Notifications"));
    expect(screen.getByText("₹1,00,000")).toBeInTheDocument();
  });

  it("shows notification times", () => {
    render(<NotificationBell notifications={notifications} />);
    fireEvent.click(screen.getByTitle("Notifications"));
    expect(screen.getByText("5 min ago")).toBeInTheDocument();
    expect(screen.getByText("1 hr ago")).toBeInTheDocument();
  });

  it("shows 'View My Approvals' link", () => {
    render(<NotificationBell notifications={notifications} />);
    fireEvent.click(screen.getByTitle("Notifications"));
    expect(screen.getByText("View My Approvals")).toBeInTheDocument();
  });

  it("closes dropdown on second click", () => {
    render(<NotificationBell notifications={notifications} />);
    const btn = screen.getByTitle("Notifications");
    fireEvent.click(btn);
    expect(screen.getByText("Budget approved")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText("Budget approved")).not.toBeInTheDocument();
  });

  it("shows loading state when no notifications provided and fetches from API", () => {
    // Mock fetch to avoid actual API calls
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByTitle("Notifications"));
    // Shows loading or empty state (no hardcoded sample notifications)
    const dropdown = screen.getByRole("menu");
    expect(dropdown).toBeInTheDocument();
  });
});


describe("notificationActionUrl", () => {
  it("prefers a truthful reviewUrl from the service metadata", () => {
    expect(notificationActionUrl("payroll_run.completed", { reviewUrl: "/hr/payroll/runs/abc" }))
      .toBe("/hr/payroll/runs/abc");
  });

  it("maps a leave-approval alert to the real leave route", () => {
    expect(notificationActionUrl("leave_approval.requested", undefined)).toBe("/hr/leave");
  });

  // Fails-before / passes-after: the old mapping returned "/payroll/runs", a
  // route that does not exist (there is no /payroll surface), so the "Review"
  // action on a payroll-run alert dead-ended in a 404.
  it("maps a payroll-run alert to a REAL route, never /payroll/runs", () => {
    const href = notificationActionUrl("payroll_run.completed", undefined);
    expect(href).toBe("/hr/payroll/runs");
    expect(href).not.toBe("/payroll/runs");
  });

  it("returns undefined for an unknown type with no reviewUrl", () => {
    expect(notificationActionUrl("something.else", {})).toBeUndefined();
  });
});

describe("NotificationBell mark-read server rejection (CLOS3-S3-11)", () => {
  const items: Notification[] = [
    { id: "1", title: "Budget approved", time: "5 min ago", read: false, icon: "✅" },
    { id: "2", title: "Payment sent", time: "1 hr ago", read: true, icon: "💳" },
  ];
  afterEach(() => { vi.unstubAllGlobals(); });

  function mockMarkRead(res: { ok: boolean; status: number }): ReturnType<typeof vi.fn> {
    const f = vi.fn(async () => res as Response);
    vi.stubGlobal("fetch", f);
    return f;
  }

  it("reverts the optimistic read state when the server answers 500 to a single mark-read", async () => {
    const f = mockMarkRead({ ok: false, status: 500 });
    render(<NotificationBell notifications={items} />);
    fireEvent.click(screen.getByTitle("Notifications"));
    fireEvent.click(screen.getByText("Budget approved"));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTitle("Notifications")).toHaveAttribute("aria-label", "Notifications, 1 unread"));
    expect(screen.getAllByLabelText("Unread")).toHaveLength(1);
  });

  it("reverts Mark all read when the server answers 403", async () => {
    const f = mockMarkRead({ ok: false, status: 403 });
    render(<NotificationBell notifications={items} />);
    fireEvent.click(screen.getByTitle("Notifications"));
    fireEvent.click(screen.getByText("Mark all read"));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTitle("Notifications")).toHaveAttribute("aria-label", "Notifications, 1 unread"));
    expect(screen.getAllByLabelText("Unread")).toHaveLength(1);
  });

  it("keeps the read state when the server accepts the update", async () => {
    const f = mockMarkRead({ ok: true, status: 200 });
    render(<NotificationBell notifications={items} />);
    fireEvent.click(screen.getByTitle("Notifications"));
    fireEvent.click(screen.getByText("Budget approved"));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTitle("Notifications")).toHaveAttribute("aria-label", "Notifications");
    expect(screen.queryAllByLabelText("Unread")).toHaveLength(0);
  });
});
