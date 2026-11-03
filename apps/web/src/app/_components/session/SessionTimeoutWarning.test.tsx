import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { endExpiredSession, fetchSessionTimes, refreshSession, signOut, type SessionTimes } from "@/lib/auth/sessionClient";
import { formatRemaining, SessionTimeoutWarning, WARNING_LEAD_MS } from "./SessionTimeoutWarning";

vi.mock("@/lib/auth/sessionClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/sessionClient")>();
  return {
    ...actual,
    fetchSessionTimes: vi.fn(),
    refreshSession: vi.fn(),
    endExpiredSession: vi.fn(),
    signOut: vi.fn(),
  };
});

const MIN = 60_000;
const T0 = new Date("2026-11-03T10:00:00Z").getTime();

function times(over: Partial<SessionTimes> = {}): SessionTimes {
  return {
    authenticated: true,
    accessExpiresAt: T0 + 10 * MIN,
    sessionExpiresAt: T0 + 10 * MIN,
    idleTimeoutSec: 1800,
    refreshable: true,
    ...over,
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SessionTimeoutWarning (A11Y-01, WCAG 2.2.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    window.localStorage.clear();
    vi.mocked(fetchSessionTimes).mockReset().mockResolvedValue(times());
    vi.mocked(refreshSession).mockReset().mockResolvedValue({ ok: false, expired: false });
    vi.mocked(endExpiredSession).mockReset().mockResolvedValue();
    vi.mocked(signOut).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays hidden while the session has more than 2 minutes left", async () => {
    render(<SessionTimeoutWarning />);
    await advance(7 * MIN);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("warns an idle user 2 minutes before the end: alertdialog with an accessible name, description and focus on 'Stay signed in'", async () => {
    render(<SessionTimeoutWarning />);
    await advance(8 * MIN + 1_000);
    const dialog = screen.getByRole("alertdialog", { name: "Your session is about to expire" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const descId = dialog.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)).toHaveTextContent(/signed out in 1 minute 59 seconds/);
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stay signed in" }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("'Stay signed in' extends the session via refresh and closes the dialog", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ ok: true, times: times({ sessionExpiresAt: T0 + 40 * MIN, accessExpiresAt: T0 + 40 * MIN }) });
    render(<SessionTimeoutWarning />);
    await advance(8 * MIN + 1_000);
    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    await advance(0);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // and it does not come back at the old deadline
    await advance(5 * MIN);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(endExpiredSession).not.toHaveBeenCalled();
  });

  it("is Escape-safe: Escape keeps the session (refresh), it never signs out", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ ok: true, times: times({ sessionExpiresAt: T0 + 40 * MIN }) });
    render(<SessionTimeoutWarning />);
    await advance(8 * MIN + 1_000);
    fireEvent.keyDown(document, { key: "Escape" });
    await advance(0);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("'Sign out' signs out", async () => {
    render(<SessionTimeoutWarning />);
    await advance(8 * MIN + 1_000);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out cleanly at the deadline when the warning goes unanswered", async () => {
    render(<SessionTimeoutWarning />);
    await advance(10 * MIN + 2_000);
    expect(endExpiredSession).toHaveBeenCalledTimes(1);
  });

  it("signs out when 'Stay signed in' finds the session already revoked", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ ok: false, expired: true });
    render(<SessionTimeoutWarning />);
    await advance(8 * MIN + 1_000);
    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    await advance(0);
    expect(endExpiredSession).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open with an announced error when the refresh is only temporarily unavailable", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ ok: false, expired: false });
    render(<SessionTimeoutWarning />);
    await advance(8 * MIN + 1_000);
    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    await advance(0);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t extend your session/);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(endExpiredSession).not.toHaveBeenCalled();
  });

  it("silently refreshes an ACTIVE user's session before the end, with no dialog", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ ok: true, times: times({ sessionExpiresAt: T0 + 36 * MIN }) });
    render(<SessionTimeoutWarning />);
    await advance(6 * MIN);
    fireEvent.keyDown(window, { key: "a" });
    await advance(2_000);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    await advance(3 * MIN);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("enforces the idle window even if background requests renewed the session server-side", async () => {
    // Server says the session runs much longer (renewed by polling), but the
    // user has not touched anything: the realm's idle window (30 min) applies.
    vi.mocked(fetchSessionTimes).mockResolvedValue(times({ sessionExpiresAt: T0 + 60 * MIN, idleTimeoutSec: 30 * 60 }));
    render(<SessionTimeoutWarning />);
    await advance(28 * MIN + 1_000);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("does not warn when another tab reports recent activity", async () => {
    render(<SessionTimeoutWarning />);
    await advance(7 * MIN);
    // Another tab renewed the session and recorded activity.
    window.localStorage.setItem("civitasone.session.lastActivity", String(Date.now()));
    vi.mocked(fetchSessionTimes).mockResolvedValue(times({ sessionExpiresAt: T0 + 37 * MIN }));
    await advance(2 * MIN);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("at Keycloak's maximum session length says it cannot be extended and offers 'Continue working' / 'Sign out now'", async () => {
    vi.mocked(fetchSessionTimes).mockResolvedValue(times({ refreshable: false, sessionExpiresAt: null, idleTimeoutSec: null, accessExpiresAt: T0 + 5 * MIN }));
    render(<SessionTimeoutWarning />);
    await advance(3 * MIN + 1_000);
    expect(screen.getByRole("alertdialog", { name: "Your session is ending" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stay signed in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue working" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await advance(2 * MIN);
    expect(endExpiredSession).toHaveBeenCalledTimes(1);
  });

  it("formats the remaining time in words for screen readers", () => {
    expect(formatRemaining(WARNING_LEAD_MS)).toBe("2 minutes");
    expect(formatRemaining(61_000)).toBe("1 minute 1 second");
    expect(formatRemaining(0)).toBe("0 seconds");
  });
});
