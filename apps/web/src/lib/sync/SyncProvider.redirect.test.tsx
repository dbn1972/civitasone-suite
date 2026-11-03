import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SyncProvider } from "./SyncProvider";
import * as requestQueue from "./requestQueue";
import { NEXT_PAGE_REDIRECT_META_ID, __resetPageLifecycleForTests } from "@/lib/navigation/pageLifecycle";

vi.mock("./indexedDb", async (orig) => {
  const actual = await orig<typeof import("./indexedDb")>();
  return { ...actual, registerServiceWorker: vi.fn(), requestBackgroundSync: vi.fn() };
});
vi.mock("./requestQueue", async (orig) => {
  const actual = await orig<typeof import("./requestQueue")>();
  return { ...actual, flushRequestQueue: vi.fn() };
});

const flushRequestQueue = vi.mocked(requestQueue.flushRequestQueue);
const tick = () => new Promise((r) => setTimeout(r, 0));

// F132 (UAT-P2-D2): the mount-time queue replay resolves the session
// namespace via GET /api/auth/session; on a redirecting page that request was
// aborted by the navigation.
describe("SyncProvider mount replay on a page that is navigating away (F132)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flushRequestQueue.mockResolvedValue({ flushed: 0, remaining: 0 });
  });
  afterEach(() => {
    document.getElementById(NEXT_PAGE_REDIRECT_META_ID)?.remove();
    __resetPageLifecycleForTests();
  });

  it("does not replay (no /api/auth/session read) when the page is redirecting", async () => {
    const meta = document.createElement("meta");
    meta.id = NEXT_PAGE_REDIRECT_META_ID;
    document.head.appendChild(meta);
    render(<SyncProvider />);
    await tick();
    expect(flushRequestQueue).not.toHaveBeenCalled();
  });

  it("does not replay when unmounted before the page settled", async () => {
    const { unmount } = render(<SyncProvider />);
    unmount();
    await tick();
    expect(flushRequestQueue).not.toHaveBeenCalled();
  });

  it("a reconnect on a live page still replays", async () => {
    render(<SyncProvider />);
    await tick();
    expect(flushRequestQueue).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online"));
    expect(flushRequestQueue).toHaveBeenCalledTimes(2);
  });
});
