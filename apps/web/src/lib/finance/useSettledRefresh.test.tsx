import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SETTLE_DELAYS_MS, useSettledRefresh } from "./useSettledRefresh";

describe("useSettledRefresh (202 + re-read)", () => {
  afterEach(() => vi.useRealTimers());

  it("re-reads now and at each settle delay, and stops on unmount", () => {
    vi.useFakeTimers();
    const router = { refresh: vi.fn() };
    const { result, unmount } = renderHook(() => useSettledRefresh(router));
    act(() => result.current());
    act(() => { vi.advanceTimersByTime(0); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(router.refresh).toHaveBeenCalledTimes(SETTLE_DELAYS_MS.length);
    router.refresh.mockClear();
    act(() => result.current());
    unmount();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a second action restarts the schedule instead of stacking timers", () => {
    vi.useFakeTimers();
    const router = { refresh: vi.fn() };
    const { result } = renderHook(() => useSettledRefresh(router));
    act(() => result.current());
    act(() => result.current());
    act(() => { vi.advanceTimersByTime(6000); });
    expect(router.refresh).toHaveBeenCalledTimes(SETTLE_DELAYS_MS.length);
  });
});
