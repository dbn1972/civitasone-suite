import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startBoundedPoll } from "./boundedPoll";

describe("startBoundedPoll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves on the attempt where the change becomes visible and stops polling", async () => {
    const check = vi.fn(async (attempt: number) => (attempt === 3 ? "ready" : null));
    const onResolved = vi.fn();
    const onExhausted = vi.fn();
    startBoundedPoll({ check, onResolved, onExhausted, intervalMs: 1000, maxAttempts: 5 });

    await vi.advanceTimersByTimeAsync(999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(onResolved).toHaveBeenCalledExactlyOnceWith("ready");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts when the change never appears", async () => {
    const check = vi.fn(async () => null);
    const onResolved = vi.fn();
    const onExhausted = vi.fn();
    startBoundedPoll({ check, onResolved, onExhausted, intervalMs: 1000, maxAttempts: 5 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(check).toHaveBeenCalledTimes(5);
    expect(onResolved).not.toHaveBeenCalled();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("treats a failing check as 'not yet' rather than ending the poll", async () => {
    const check = vi.fn(async (attempt: number) => {
      if (attempt < 2) throw new Error("network");
      return 42;
    });
    const onResolved = vi.fn();
    startBoundedPoll({ check, onResolved, onExhausted: vi.fn(), intervalMs: 1000, maxAttempts: 5 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onResolved).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("cancel() stops the timer and suppresses both callbacks", async () => {
    const check = vi.fn(async () => null);
    const onResolved = vi.fn();
    const onExhausted = vi.fn();
    const cancel = startBoundedPoll({ check, onResolved, onExhausted, intervalMs: 1000, maxAttempts: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onResolved).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("a check that resolves after cancel() does not call back", async () => {
    let release: (v: string | null) => void = () => {};
    const check = vi.fn(() => new Promise<string | null>((r) => { release = r; }));
    const onResolved = vi.fn();
    const cancel = startBoundedPoll({ check, onResolved, onExhausted: vi.fn(), intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    cancel();
    release("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(onResolved).not.toHaveBeenCalled();
  });
});
