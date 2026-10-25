/**
 * SC-6: Circuit breaker unit tests
 *
 * Tests the three-state machine:
 *   closed → open (after N consecutive failures)
 *   open   → half-open (after recoveryMs)
 *   half-open → closed (on success) | open (on failure)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "../src/index.js";

const OK = async () => "ok";
const FAIL = async (): Promise<never> => { throw new Error("upstream failure"); };

describe("CircuitBreaker — closed state", () => {
  it("passes through successful calls and stays closed", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 3, recoveryMs: 1000 });
    expect(cb.state).toBe("closed");
    const result = await cb.call(OK);
    expect(result).toBe("ok");
    expect(cb.state).toBe("closed");
  });

  it("resets the failure counter on a success between failures", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 3, recoveryMs: 1000 });

    await expect(cb.call(FAIL)).rejects.toThrow();
    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("closed"); // not yet at threshold

    await cb.call(OK); // success resets the counter
    expect(cb.state).toBe("closed");

    // Needs another 3 consecutive failures to open.
    await expect(cb.call(FAIL)).rejects.toThrow();
    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("closed");

    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("open");
  });

  it("trips to open after N consecutive failures", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 2, recoveryMs: 500 });
    await expect(cb.call(FAIL)).rejects.toThrow("upstream failure");
    expect(cb.state).toBe("closed");
    await expect(cb.call(FAIL)).rejects.toThrow("upstream failure");
    expect(cb.state).toBe("open");
  });
});

describe("CircuitBreaker — open state", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("rejects calls immediately without invoking fn", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 1000 });
    await expect(cb.call(FAIL)).rejects.toThrow("upstream failure");
    expect(cb.state).toBe("open");

    let called = false;
    await expect(cb.call(async () => { called = true; return "x"; }))
      .rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(called).toBe(false);
  });

  it("transitions to half-open after the recovery window", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 500 });
    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(499);
    expect(cb.state).toBe("open"); // still open

    vi.advanceTimersByTime(1);
    expect(cb.state).toBe("half-open"); // recovery elapsed
  });
});

describe("CircuitBreaker — half-open state", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("closes on a successful probe call", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 100 });
    await expect(cb.call(FAIL)).rejects.toThrow();
    vi.advanceTimersByTime(100);
    expect(cb.state).toBe("half-open");

    const result = await cb.call(OK);
    expect(result).toBe("ok");
    expect(cb.state).toBe("closed");
  });

  it("trips back to open and resets the timer on a failed probe call", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 100 });
    await expect(cb.call(FAIL)).rejects.toThrow();
    vi.advanceTimersByTime(100);
    expect(cb.state).toBe("half-open");

    await expect(cb.call(FAIL)).rejects.toThrow("upstream failure");
    expect(cb.state).toBe("open");

    // Must wait the full recovery window again.
    vi.advanceTimersByTime(99);
    expect(cb.state).toBe("open");
    vi.advanceTimersByTime(1);
    expect(cb.state).toBe("half-open");
  });
});

describe("CircuitBreaker — constructor validation", () => {
  it("throws RangeError for failureThreshold < 1", () => {
    expect(() => new CircuitBreaker({ name: "x", failureThreshold: 0, recoveryMs: 100 }))
      .toThrow(RangeError);
  });
  it("throws RangeError for negative recoveryMs", () => {
    expect(() => new CircuitBreaker({ name: "x", failureThreshold: 1, recoveryMs: -1 }))
      .toThrow(RangeError);
  });
});

describe("CircuitBreaker — half-open single probe (CLOS2-S6-03)", () => {
  const trip = async (cb: CircuitBreaker) => {
    await expect(cb.call(FAIL)).rejects.toThrow("upstream failure");
  };

  it("admits ONE probe; concurrent callers are rejected while it is in flight", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 0 });
    await trip(cb);
    expect(cb.state).toBe("half-open");

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fn = vi.fn(async () => { await gate; return "ok"; });

    const results = Promise.allSettled([cb.call(fn), cb.call(fn), cb.call(fn)]);
    release();
    const settled = await results;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("a successful probe closes the breaker and calls flow again", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 0 });
    await trip(cb);
    await expect(cb.call(OK)).resolves.toBe("ok");
    expect(cb.state).toBe("closed");
    await expect(Promise.all([cb.call(OK), cb.call(OK)])).resolves.toEqual(["ok", "ok"]);
  });

  it("a failed probe re-opens the breaker and releases the probe flag", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 0 });
    await trip(cb);
    await trip(cb); // probe fails -> open (recoveryMs 0 -> half-open again immediately)
    await expect(cb.call(OK)).resolves.toBe("ok");
  });

  it("a probe aborted with countsAsFailure=false clears the flag so a later call can probe", async () => {
    const cb = new CircuitBreaker({
      name: "svc",
      failureThreshold: 1,
      recoveryMs: 0,
      countsAsFailure: (e) => !(e instanceof Error && e.name === "AbortError"),
    });
    await trip(cb);
    const abort = async (): Promise<never> => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    await expect(cb.call(abort)).rejects.toThrow("aborted");
    expect(cb.state).toBe("half-open");
    await expect(cb.call(OK)).resolves.toBe("ok");
    expect(cb.state).toBe("closed");
  });
});

describe("CircuitBreaker — stale in-flight calls (CLOS3-S6-10)", () => {
  const gated = <T,>(result: () => Promise<T>) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    return { fn: async () => { await gate; return result(); }, release };
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a stale in-flight SUCCESS after a trip leaves the breaker open", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 2, recoveryMs: 10_000 });
    const slow = gated(async () => "late-ok");
    const slowCall = cb.call(slow.fn);
    await expect(cb.call(FAIL)).rejects.toThrow();
    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("open");

    slow.release();
    await expect(slowCall).resolves.toBe("late-ok");

    expect(cb.state).toBe("open");
    await expect(cb.call(OK)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("a stale in-flight FAILURE while open does not extend openedAt or re-trip", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 1_000 });
    const slow = gated(FAIL);
    const slowCall = cb.call(slow.fn);
    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(900);
    slow.release();
    await expect(slowCall).rejects.toThrow("upstream failure");
    vi.advanceTimersByTime(200); // 1100ms since the real trip: must be half-open
    expect(cb.state).toBe("half-open");
  });

  it("a normal closed-state success still resets the consecutive-failure counter", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 2, recoveryMs: 1_000 });
    await expect(cb.call(FAIL)).rejects.toThrow();
    await cb.call(OK);
    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("closed");
  });

  it("half-open probe: success closes, failure re-opens", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 1_000 });
    await expect(cb.call(FAIL)).rejects.toThrow();
    vi.advanceTimersByTime(1_000);
    await expect(cb.call(OK)).resolves.toBe("ok");
    expect(cb.state).toBe("closed");

    await expect(cb.call(FAIL)).rejects.toThrow();
    vi.advanceTimersByTime(1_000);
    await expect(cb.call(FAIL)).rejects.toThrow();
    expect(cb.state).toBe("open");
  });

  it("a call from a previous epoch resolving after recovery has no effect on the half-open probe", async () => {
    const cb = new CircuitBreaker({ name: "svc", failureThreshold: 1, recoveryMs: 1_000 });
    const slow = gated(async () => "stale");
    const slowCall = cb.call(slow.fn); // started while closed
    await expect(cb.call(FAIL)).rejects.toThrow(); // trips
    vi.advanceTimersByTime(1_000);
    expect(cb.state).toBe("half-open");

    slow.release();
    await slowCall;
    expect(cb.state).toBe("half-open"); // the stale success did not close it
  });
});
