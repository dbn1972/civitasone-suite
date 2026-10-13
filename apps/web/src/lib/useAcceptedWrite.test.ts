import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) }));

import { useAcceptedWrite } from "./useAcceptedWrite";

describe("useAcceptedWrite", () => {
  beforeEach(() => { vi.useFakeTimers(); refresh.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it("accept() with no poll settles at 'accepted' and does NOT refresh on a timer", async () => {
    const { result } = renderHook(() => useAcceptedWrite());
    expect(result.current.phase).toBe("idle");
    await act(async () => { await result.current.accept(); });
    expect(result.current.phase).toBe("accepted");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refresh).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("accepted");
  });

  it("manual refresh calls router.refresh once and flags the notice as refreshed", async () => {
    const { result } = renderHook(() => useAcceptedWrite());
    await act(async () => { await result.current.accept(); });
    expect(result.current.noticeProps.refreshed).toBe(false);
    act(() => { result.current.refresh(); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.noticeProps.refreshed).toBe(true);
    expect(result.current.phase).toBe("accepted");
  });

  it("run() goes submitting -> accepted when the write succeeds", async () => {
    const { result } = renderHook(() => useAcceptedWrite<{ id: string }>());
    let p!: Promise<void>;
    let release!: () => void;
    act(() => { p = result.current.run(() => new Promise((r) => { release = () => r({ id: "1" }); })); });
    expect(result.current.phase).toBe("submitting");
    await act(async () => { release(); await p; });
    expect(result.current.phase).toBe("accepted");
  });

  it("run() surfaces a failed write as error with the message, never as accepted", async () => {
    const { result } = renderHook(() => useAcceptedWrite());
    await act(async () => { await result.current.run(async () => { throw new Error("Not permitted"); }); });
    expect(result.current.phase).toBe("error");
    expect(result.current.noticeProps.error).toBe("Not permitted");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("with poll+isDone: pending, then confirmed and the page is refreshed once", async () => {
    let calls = 0;
    const poll = vi.fn(async () => ({ ready: ++calls >= 2 }));
    const { result } = renderHook(() =>
      useAcceptedWrite<{ id: string }, { ready: boolean }>({ poll, isDone: (p) => p.ready, initialDelayMs: 10, maxAttempts: 4 }),
    );
    let p!: Promise<void>;
    act(() => { p = result.current.accept({ id: "1" }); });
    expect(result.current.phase).toBe("pending");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); await p; });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("confirmed");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("with poll that never confirms: bounded attempts, then timed_out (not success)", async () => {
    const poll = vi.fn(async () => ({ ready: false }));
    const { result } = renderHook(() =>
      useAcceptedWrite<{ id: string }, { ready: boolean }>({ poll, isDone: (p) => p.ready, initialDelayMs: 10, maxAttempts: 3 }),
    );
    let p!: Promise<void>;
    act(() => { p = result.current.accept({ id: "1" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await p; });
    expect(poll).toHaveBeenCalledTimes(3);
    expect(result.current.phase).toBe("timed_out");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reset() returns to idle", async () => {
    const { result } = renderHook(() => useAcceptedWrite());
    await act(async () => { await result.current.accept(); });
    act(() => { result.current.reset(); });
    expect(result.current.phase).toBe("idle");
  });
});
