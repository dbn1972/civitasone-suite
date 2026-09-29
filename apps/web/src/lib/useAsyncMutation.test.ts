import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncMutation } from "./useAsyncMutation";

type Mutated = { id: string };
type Polled = { data: Array<{ id: string }> };

function isDone(polled: Polled, mutated: Mutated): boolean {
  return polled.data.some((row) => row.id === mutated.id);
}

describe("useAsyncMutation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle and is not busy before run() is called", () => {
    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({
        mutate: vi.fn(),
        poll: vi.fn(),
        isDone,
      }),
    );
    expect(result.current.phase).toBe("idle");
    expect(result.current.isBusy).toBe(false);
  });

  it("shows the pending phase immediately once the mutation is accepted, before any poll resolves", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "abc" });
    let resolvePoll: ((v: Polled) => void) | undefined;
    const poll = vi.fn(
      () =>
        new Promise<Polled>((resolve) => {
          resolvePoll = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({ mutate, poll, isDone, initialDelayMs: 100 }),
    );

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run();
    });

    // Flush the mutate() microtask without advancing any timers yet.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phase).toBe("pending");
    expect(result.current.isBusy).toBe(true);
    expect(poll).not.toHaveBeenCalled(); // first poll waits for initialDelayMs

    // Let the flow finish so the test doesn't leak a hanging promise.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    resolvePoll?.({ data: [{ id: "abc" }] });
    await act(async () => {
      await runPromise;
    });
    expect(result.current.phase).toBe("confirmed");
  });

  it("stops polling as soon as the expected change appears, and reports confirmed", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "abc" });
    const poll = vi
      .fn<(mutated: Mutated, attempt: number) => Promise<Polled>>()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: "other" }] })
      .mockResolvedValueOnce({ data: [{ id: "abc" }] });
    const onConfirmed = vi.fn();

    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({
        mutate,
        poll,
        isDone,
        onConfirmed,
        initialDelayMs: 100,
        backoffFactor: 1, // fixed 100ms between attempts, simpler to reason about
        maxAttempts: 5,
      }),
    );

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      await runPromise;
    });

    expect(poll).toHaveBeenCalledTimes(3); // stopped right after the match — no 4th call
    expect(result.current.phase).toBe("confirmed");
    expect(result.current.pollResult).toEqual({ data: [{ id: "abc" }] });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith({ data: [{ id: "abc" }] }, { id: "abc" });
  });

  it("falls back to timed_out after the attempt cap when the change never appears", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "abc" });
    const poll = vi.fn().mockResolvedValue({ data: [] }); // never matches
    const onTimeout = vi.fn();
    const onConfirmed = vi.fn();

    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({
        mutate,
        poll,
        isDone,
        onConfirmed,
        onTimeout,
        initialDelayMs: 50,
        backoffFactor: 1,
        maxAttempts: 3,
      }),
    );

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await runPromise;
    });

    expect(poll).toHaveBeenCalledTimes(3); // exactly the cap, no more
    expect(result.current.phase).toBe("timed_out");
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith({ id: "abc" });
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("treats a transient poll rejection as just a missed attempt, not a hard failure", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "abc" });
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ data: [{ id: "abc" }] });

    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({
        mutate,
        poll,
        isDone,
        initialDelayMs: 50,
        backoffFactor: 1,
        maxAttempts: 5,
      }),
    );

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(result.current.phase).toBe("pending"); // first attempt failed silently, kept polling

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await runPromise;
    });

    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("confirmed");
  });

  it("moves to the error phase when the mutation itself fails, and never polls", async () => {
    const mutate = vi.fn().mockRejectedValue(new Error("could not save"));
    const poll = vi.fn();

    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({ mutate, poll, isDone }),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("could not save");
    expect(poll).not.toHaveBeenCalled();
  });

  it("ignores an overlapping run() call while already busy", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "abc" });
    const poll = vi.fn().mockResolvedValue({ data: [{ id: "abc" }] });

    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({ mutate, poll, isDone, initialDelayMs: 50 }),
    );

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.run();
      second = result.current.run(); // fired while the first is still in flight
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("confirmed");
  });

  it("reset() clears back to idle so the caller can retry", async () => {
    const mutate = vi.fn().mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() =>
      useAsyncMutation<Mutated, Polled>({ mutate, poll: vi.fn(), isDone }),
    );

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.phase).toBe("error");

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBeNull();
  });
});
