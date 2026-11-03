import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { fetchSessionTimes, refreshSession, type SessionTimes } from "@/lib/auth/sessionClient";
import { NEXT_PAGE_REDIRECT_META_ID, __resetPageLifecycleForTests } from "@/lib/navigation/pageLifecycle";
import { SessionTimeoutWarning } from "./SessionTimeoutWarning";

vi.mock("@/lib/auth/sessionClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/sessionClient")>();
  return { ...actual, fetchSessionTimes: vi.fn(), refreshSession: vi.fn(), endExpiredSession: vi.fn(), signOut: vi.fn() };
});

const MIN = 60_000;
const T0 = new Date("2026-11-03T10:00:00Z").getTime();
const times: SessionTimes = {
  authenticated: true,
  accessExpiresAt: T0 + 4 * MIN,
  sessionExpiresAt: T0 + 4 * MIN,
  idleTimeoutSec: 1800,
  refreshable: true,
};

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// F132 (UAT-P2-D2): the L1 sweep saw aborted GET /api/auth/refresh and
// /api/auth/session on /estab/files, a page that only redirects.
describe("SessionTimeoutWarning on a page that is navigating away (F132)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    window.localStorage.clear();
    vi.mocked(fetchSessionTimes).mockReset().mockResolvedValue(times);
    vi.mocked(refreshSession).mockReset().mockResolvedValue({ ok: true, times });
  });
  afterEach(() => {
    document.getElementById(NEXT_PAGE_REDIRECT_META_ID)?.remove();
    __resetPageLifecycleForTests();
    vi.useRealTimers();
  });

  it("a redirecting page makes no session timing read and no refresh", async () => {
    const meta = document.createElement("meta");
    meta.id = NEXT_PAGE_REDIRECT_META_ID;
    meta.httpEquiv = "refresh";
    document.head.appendChild(meta);
    render(<SessionTimeoutWarning />);
    fireEvent.keyDown(window, { key: "a" });
    await advance(3 * MIN);
    expect(fetchSessionTimes).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("unmounting before the page settles cancels the initial read", async () => {
    const { unmount } = render(<SessionTimeoutWarning />);
    unmount();
    await advance(MIN);
    expect(fetchSessionTimes).not.toHaveBeenCalled();
  });

  it("once the page is being unloaded, a due silent refresh is not started", async () => {
    render(<SessionTimeoutWarning />);
    await advance(1_000);
    expect(fetchSessionTimes).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "a" }); // active user, within the 5-min renewal window
    window.dispatchEvent(new Event("pagehide"));
    await advance(5_000);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("control: on a normal page the active user's session is still silently renewed", async () => {
    render(<SessionTimeoutWarning />);
    await advance(1_000);
    fireEvent.keyDown(window, { key: "a" });
    await advance(2_000);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});
