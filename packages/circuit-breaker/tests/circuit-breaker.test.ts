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
