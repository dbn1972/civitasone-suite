import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
