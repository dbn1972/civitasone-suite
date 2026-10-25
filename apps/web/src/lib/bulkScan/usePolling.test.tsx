import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling, type PollOutcome } from "./usePolling";

const KEEP: PollOutcome = { keepGoing: true, changed: false, failed: false };

function deferred(): { promise: Promise<PollOutcome>; resolve: (o: PollOutcome) => void } {
  let resolve!: (o: PollOutcome) => void;
  const promise = new Promise<PollOutcome>((r) => { resolve = r; });
  return { promise, resolve };
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

describe("usePolling overlap (CLOS3-S3-02)", () => {
  beforeEach(() => { vi.useFakeTimers(); setVisibility("visible"); });
  afterEach(() => { vi.useRealTimers(); setVisibility("visible"); });

  it("a refreshNow() during an in-flight tick does not start a second polling chain", async () => {
    const pending: Array<ReturnType<typeof deferred>> = [];
    let calls = 0;
    const tick = vi.fn(() => {
      calls += 1;
      if (calls <= 2) { const d = deferred(); pending.push(d); return d.promise; }
      return Promise.resolve(KEEP);
    });
    const { result, unmount } = renderHook(() => usePolling(tick, { enabled: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(tick).toHaveBeenCalledTimes(1);
    await act(async () => { void result.current.refreshNow(); });
    expect(tick).toHaveBeenCalledTimes(2);

    await act(async () => { pending[0]!.resolve(KEEP); pending[1]!.resolve(KEEP); await Promise.resolve(); });
    expect(vi.getTimerCount()).toBe(1);
    const before = tick.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    const overlapped = tick.mock.calls.length - before;
    unmount();

    // Baseline: a single chain with the same backoff schedule.
    const single = vi.fn(() => Promise.resolve(KEEP));
    const base = renderHook(() => usePolling(single, { enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    const b0 = single.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    const baseline = single.mock.calls.length - b0;
    base.unmount();
    expect(overlapped).toBeLessThanOrEqual(baseline);
  });

  it("a visibilitychange to visible during an in-flight tick leaves exactly one chain", async () => {
    const pending: Array<ReturnType<typeof deferred>> = [];
    let calls = 0;
    const tick = vi.fn(() => {
      calls += 1;
      if (calls <= 2) { const d = deferred(); pending.push(d); return d.promise; }
      return Promise.resolve(KEEP);
    });
    const { unmount } = renderHook(() => usePolling(tick, { enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(tick).toHaveBeenCalledTimes(2);
    await act(async () => { pending[0]!.resolve(KEEP); pending[1]!.resolve(KEEP); await Promise.resolve(); });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
  });

  it("unmounting during an in-flight tick schedules nothing", async () => {
    const d = deferred();
    const tick = vi.fn(() => d.promise);
    const { unmount } = renderHook(() => usePolling(tick, { enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(tick).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { d.resolve(KEEP); await Promise.resolve(); });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
