/**
 * V4-A-01: performLogout must wipe Cache Storage (civitasone-* caches) and tell
 * the service worker to purge, in addition to the IndexedDB/key/token wipes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./indexedDb", () => ({ wipeLocalStore: vi.fn(async () => {}) }));
vi.mock("./requestQueue", () => ({ wipeRequestQueue: vi.fn(async () => {}) }));
vi.mock("./responseCache", () => ({ wipeResponseCache: vi.fn(async () => {}) }));
vi.mock("./crypto", () => ({ wipeSessionKey: vi.fn() }));
vi.mock("./identity", () => ({ resolveNamespace: vi.fn(async () => null), clearNamespaceCache: vi.fn() }));
vi.mock("./headers", () => ({ clearTrustToken: vi.fn() }));

import { performLogout } from "./logout";

describe("performLogout Cache Storage wipe (V4-A-01)", () => {
  const deleted: string[] = [];
  const posted: unknown[] = [];

  beforeEach(() => {
    deleted.length = 0;
    posted.length = 0;
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true, configurable: true });
    vi.stubGlobal("caches", {
      keys: async () => ["civitasone-shell-v2", "civitasone-data-v1", "other-app-cache"],
      delete: async (k: string) => {
        deleted.push(k);
        return true;
      },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: { postMessage: (m: unknown) => posted.push(m) } },
      configurable: true,
    });
  });

  it("deletes civitasone-* caches only, asks the SW to purge, then hands off to /logout", async () => {
    await performLogout();
    expect(deleted.sort()).toEqual(["civitasone-data-v1", "civitasone-shell-v2"]);
    expect(posted).toEqual([{ type: "CIVITASONE_PURGE" }]);
    expect(window.location.href).toBe("/logout");
  });

  it("still logs out when Cache Storage throws", async () => {
    vi.stubGlobal("caches", {
      keys: async () => {
        throw new Error("blocked");
      },
    });
    await performLogout();
    expect(window.location.href).toBe("/logout");
  });
});
