/**
 * downloadAndStoreOrder timeout must cover the body read, not just time-to-headers (CLOS3-S5-14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ putObject: vi.fn(async () => undefined) }));

vi.mock("@civitasone/storage", () => ({ putObject: (...a: unknown[]) => H.putObject(...(a as [])) }));
vi.mock("../../shared/db.js", () => ({ db: {} }));

import { downloadAndStoreOrder } from "./sync-consumer.js";

const order = { date: "2026-10-01", downloadUrl: "https://court.invalid/o.pdf" } as never;

describe("downloadAndStoreOrder timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    H.putObject.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts and returns null when headers arrive but the body stalls", async () => {
    vi.stubGlobal("fetch", async (_u: unknown, init: RequestInit) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      // Never resolves unless the request is aborted.
      arrayBuffer: () =>
        new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason))),
    }));
    const p = downloadAndStoreOrder(order, "case1", "tenant1");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBeNull();
    expect(H.putObject).not.toHaveBeenCalled();
  });

  it("stores the PDF and clears the timer on a normal download", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "4" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }));
    const key = await downloadAndStoreOrder(order, "case1", "tenant1");
    expect(key).toBe("legal/tenant1/case1/orders/20261001.pdf");
    expect(H.putObject).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer on a non-OK response", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, headers: { get: () => null } }));
    expect(await downloadAndStoreOrder(order, "case1", "tenant1")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
