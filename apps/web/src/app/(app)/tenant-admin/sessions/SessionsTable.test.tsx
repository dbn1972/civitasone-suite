import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SessionsTable } from "./SessionsTable";

const SESSION = {
  id: "s1",
  userEmail: "clerk@gov.in",
  userName: "A. Clerk",
  ipAddress: "10.1.2.3",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/1",
  lastActiveAt: "2026-09-01T00:00:00Z",
  mfaVerified: true,
  status: "active" as const,
};

describe("SessionsTable — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when revoking a session fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("redis session store unreachable", { status: 503 }),
    );

    render(<SessionsTable sessions={[SESSION]} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "compromised device" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke session" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/redis session store/i);
    expect(dialog.textContent).not.toMatch(/\b503\b/);
  });
});

describe("SessionsTable — SESSIONS-02/04/05", () => {
  const SESSIONS = [
    { ...SESSION, id: "s-active", userId: "u-1", lastActiveAt: "2026-09-01T09:05:00Z", status: "active" as const },
    { ...SESSION, id: "s-own", userId: "admin-9", userName: "The Admin", status: "active" as const },
    { ...SESSION, id: "s-expired", userId: "u-2", status: "expired" as const },
    { ...SESSION, id: "s-revoked", userId: "u-3", status: "revoked" as const },
  ];

  it("renders the last-active time (not just the date) via formatIndianDateTime", () => {
    render(<SessionsTable sessions={[SESSIONS[0]]} />);
    // 2026-09-01T09:05:00Z -> 14:35 IST
    expect(screen.getByText(/01 Sep 2026, 02:35 pm/i)).toBeInTheDocument();
  });

  it("marks the admin's own session and hides its Revoke button", () => {
    render(<SessionsTable sessions={SESSIONS} currentUserId="admin-9" />);
    expect(screen.getByText("This session")).toBeInTheDocument();
    // Only the one non-own active session offers Revoke.
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("offers a View link to each session's detail route", () => {
    render(<SessionsTable sessions={[SESSIONS[0]]} />);
    const link = screen.getByRole("link", { name: /View session for/i });
    expect(link).toHaveAttribute("href", "/tenant-admin/sessions/s-active");
  });

  it("has an Expired filter that shows only expired sessions", () => {
    render(<SessionsTable sessions={SESSIONS} currentUserId="admin-9" />);
    // All four rows visible under "All".
    expect(screen.getAllByRole("link", { name: /View session/i })).toHaveLength(4);
    fireEvent.click(screen.getByRole("tab", { name: "Expired" }));
    const links = screen.getAllByRole("link", { name: /View session/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/tenant-admin/sessions/s-expired");
  });
});
