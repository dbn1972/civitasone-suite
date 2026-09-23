import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SyncProvider } from "./SyncProvider";
import * as indexedDb from "./indexedDb";
import * as engine from "./engine";
import * as identity from "./identity";
import * as requestQueue from "./requestQueue";
import * as clientCore from "@civitasone/client-core";

/**
 * SYNC-OFF (2026-09-23): `POST /api/proxy/v1/sync/pull` (and the /devices/
 * register call that precedes it) 403'd on every single page load, for every
 * role including super_admin, because the identity-service worker that turns
 * a device-register request into an actual trusted-device row has not been
 * running in production — see the comment above `SYNC_ENABLED` in
 * SyncProvider.tsx for the full root-cause writeup. SyncProvider now no-ops
 * while `SYNC_ENABLED` is false.
 *
 * This test is the sabotage check for that flag: every function the effect
 * would otherwise call is mocked here, so flipping `SYNC_ENABLED` back to
 * `true` makes this test fail (each of these mocks gets called) — proving the
 * assertions actually detect the dead call firing again, not just that the
 * component renders.
 */

vi.mock("./indexedDb", async (orig) => {
  const actual = await orig<typeof import("./indexedDb")>();
  return { ...actual, registerServiceWorker: vi.fn(), requestBackgroundSync: vi.fn() };
});
vi.mock("./engine", async (orig) => {
  const actual = await orig<typeof import("./engine")>();
  return { ...actual, syncMailbox: vi.fn() };
});
vi.mock("./identity", async (orig) => {
  const actual = await orig<typeof import("./identity")>();
  return { ...actual, resolveNamespace: vi.fn() };
});
vi.mock("./requestQueue", async (orig) => {
  const actual = await orig<typeof import("./requestQueue")>();
  return { ...actual, flushRequestQueue: vi.fn() };
});
vi.mock("@civitasone/client-core", async (orig) => {
  const actual = await orig<typeof import("@civitasone/client-core")>();
  return {
    ...actual,
    getOrCreateDeviceId: vi.fn(() => "device-1"),
    computeBrowserFingerprint: vi.fn(),
  };
});

const registerServiceWorker = vi.mocked(indexedDb.registerServiceWorker);
const requestBackgroundSync = vi.mocked(indexedDb.requestBackgroundSync);
const syncMailbox = vi.mocked(engine.syncMailbox);
const resolveNamespace = vi.mocked(identity.resolveNamespace);
const flushRequestQueue = vi.mocked(requestQueue.flushRequestQueue);
const getOrCreateDeviceId = vi.mocked(clientCore.getOrCreateDeviceId);
const computeBrowserFingerprint = vi.mocked(clientCore.computeBrowserFingerprint);

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SyncProvider (disabled while identity-worker is down in production)", () => {
  it("makes no /devices/register or /sync/pull calls, and touches none of its sync helpers", async () => {
    render(<SyncProvider />);

    // The effect's async work is chained microtasks off zero real timers/
    // network; one macrotask tick is enough for all of it to drain if it ran.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(registerServiceWorker).not.toHaveBeenCalled();
    expect(requestBackgroundSync).not.toHaveBeenCalled();
    expect(syncMailbox).not.toHaveBeenCalled();
    expect(resolveNamespace).not.toHaveBeenCalled();
    expect(flushRequestQueue).not.toHaveBeenCalled();
    expect(getOrCreateDeviceId).not.toHaveBeenCalled();
    expect(computeBrowserFingerprint).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const { container } = render(<SyncProvider />);
    expect(container).toBeEmptyDOMElement();
  });
});
