/**
 * CLOS3-S5-15 (always-on, no DB): setInterval does not wait for the previous
 * tick, so an overlapping tick must return immediately without touching any
 * matter, and the busy flag must reset even when the tick throws.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  release: undefined as undefined | (() => void),
  discoveries: 0,
  failDiscovery: false,
  orderByArgs: 0,
}));

const chain = (): unknown => new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res([]) : chain()),
  apply: () => chain(),
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(chain()) },
}));
vi.mock("../src/shared/scanner-db.js", () => ({
  scannerDb: {
    select: () => ({
      from: () => ({
        orderBy: (...a: unknown[]) => {
          H.orderByArgs = a.length;
          return {
            limit: async () => {
              H.discoveries++;
              if (H.failDiscovery) throw new Error("scanner down");
              await new Promise<void>((r) => { H.release = r; });
              return [];
            },
          };
        },
      }),
    }),
  },
}));
vi.mock("../src/modules/ecourts/adapter.js", () => ({ isEnabled: () => true, lookupCnr: vi.fn() }));
vi.mock("@civitasone/storage", () => ({ putObject: vi.fn() }));

import { tick } from "../src/modules/ecourts/sync-consumer.js";

describe("CLOS3-S5-15 tick() re-entrancy guard and ordering", () => {
  beforeEach(() => { H.discoveries = 0; H.failDiscovery = false; H.release = undefined; });

  it("an overlapping tick returns immediately and does not run a second discovery", async () => {
    const first = tick();
    await vi.waitFor(() => expect(H.release).toBeDefined());
    const second = await tick();
    expect(second).toEqual({ synced: 0, failed: 0 });
    expect(H.discoveries).toBe(1);
    H.release!();
    await first;
    expect(H.orderByArgs, "discovery must be ordered (last_sync_at NULLS FIRST, id)").toBe(2);
  });

  it("the busy flag resets after a failed tick so the next tick runs", async () => {
    H.failDiscovery = true;
    await expect(tick()).rejects.toThrow("scanner down");
    H.failDiscovery = false;
    const next = tick();
    await vi.waitFor(() => expect(H.release).toBeDefined());
    H.release!();
    await expect(next).resolves.toEqual({ synced: 0, failed: 0 });
    expect(H.discoveries).toBe(2);
  });
});
