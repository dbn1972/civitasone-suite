/**
 * V-05 — Circuit breaker integration test.
 *
 * Verifies the full lifecycle of the circuit breaker state machine:
 * 1. A healthy upstream returns data normally (circuit closed)
 * 2. After N consecutive failures, the circuit opens and fast-fails without calling upstream
 * 3. After the reset timeout, the circuit enters half-open and allows a probe
 * 4. A successful probe closes the circuit
 *
 * Uses the real @civitasone/circuit-breaker package with a mock upstream function.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "../../packages/circuit-breaker/src/index.js";

describe("Circuit breaker integration: full state lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("closed → passes calls through to upstream when healthy", async () => {
    const cb = new CircuitBreaker({ name: "finance-svc", failureThreshold: 3, recoveryMs: 5000 });
    let callCount = 0;
    const upstream = async () => { callCount++; return { data: "ok" }; };

    expect(cb.state).toBe("closed");

    const r1 = await cb.call(upstream);
    const r2 = await cb.call(upstream);
    const r3 = await cb.call(upstream);

    expect(r1).toEqual({ data: "ok" });
    expect(r2).toEqual({ data: "ok" });
    expect(r3).toEqual({ data: "ok" });
    expect(callCount).toBe(3);
    expect(cb.state).toBe("closed");
  });

  it("closed → open after N consecutive failures", async () => {
    const cb = new CircuitBreaker({ name: "finance-svc", failureThreshold: 3, recoveryMs: 5000 });
    const fail = async (): Promise<never> => { throw new Error("connection timeout"); };

    // First two failures — still closed
    await expect(cb.call(fail)).rejects.toThrow("connection timeout");
    expect(cb.state).toBe("closed");
    await expect(cb.call(fail)).rejects.toThrow("connection timeout");
    expect(cb.state).toBe("closed");

    // Third failure trips the breaker
    await expect(cb.call(fail)).rejects.toThrow("connection timeout");
    expect(cb.state).toBe("open");
  });

  it("open state fast-fails without invoking upstream", async () => {
    const cb = new CircuitBreaker({ name: "finance-svc", failureThreshold: 2, recoveryMs: 5000 });
    const fail = async (): Promise<never> => { throw new Error("fail"); };

    // Trip the breaker
    await expect(cb.call(fail)).rejects.toThrow();
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("open");

    // Verify fast-fail: upstream is NOT called
    let upstreamCalled = false;
    const upstream = async () => { upstreamCalled = true; return "should not reach here"; };

    await expect(cb.call(upstream)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(upstreamCalled).toBe(false);
  });

  it("open → half-open after recovery timeout elapses", async () => {
    const cb = new CircuitBreaker({ name: "finance-svc", failureThreshold: 1, recoveryMs: 3000 });
    const fail = async (): Promise<never> => { throw new Error("fail"); };

    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("open");

    // Not yet — still open
    vi.advanceTimersByTime(2999);
    expect(cb.state).toBe("open");

    // After recovery timeout → half-open
    vi.advanceTimersByTime(1);
    expect(cb.state).toBe("half-open");
  });

  it("half-open → closed on successful probe call", async () => {
    const cb = new CircuitBreaker({ name: "finance-svc", failureThreshold: 1, recoveryMs: 1000 });
    const fail = async (): Promise<never> => { throw new Error("fail"); };

    // Trip to open
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("open");

    // Advance past recovery window → half-open
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    // Successful probe closes the circuit
    const success = async () => "recovered";
    const result = await cb.call(success);

    expect(result).toBe("recovered");
    expect(cb.state).toBe("closed");
  });

  it("half-open → open again on failed probe call (resets timer)", async () => {
    const cb = new CircuitBreaker({ name: "finance-svc", failureThreshold: 1, recoveryMs: 1000 });
    const fail = async (): Promise<never> => { throw new Error("still broken"); };

    // Trip to open
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("open");

    // Advance past recovery window → half-open
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    // Failed probe → back to open
    await expect(cb.call(fail)).rejects.toThrow("still broken");
    expect(cb.state).toBe("open");

    // Must wait another full recovery window
    vi.advanceTimersByTime(999);
    expect(cb.state).toBe("open");
    vi.advanceTimersByTime(1);
    expect(cb.state).toBe("half-open");
  });

  it("success between failures resets the counter (stays closed)", async () => {
    const cb = new CircuitBreaker({ name: "finance-svc", failureThreshold: 3, recoveryMs: 5000 });
    const fail = async (): Promise<never> => { throw new Error("fail"); };
    const ok = async () => "ok";

    // Two failures
    await expect(cb.call(fail)).rejects.toThrow();
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("closed");

    // Successful call resets the counter
    await cb.call(ok);
    expect(cb.state).toBe("closed");

    // Need another 3 consecutive failures to trip
    await expect(cb.call(fail)).rejects.toThrow();
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("closed"); // only 2 consecutive
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("open"); // 3 consecutive now
  });

  it("full lifecycle: closed → open → half-open → closed (end-to-end)", async () => {
    const cb = new CircuitBreaker({ name: "payment-gateway", failureThreshold: 2, recoveryMs: 2000 });
    const fail = async (): Promise<never> => { throw new Error("503 Service Unavailable"); };
    const ok = async () => ({ status: 200, body: "payment processed" });

    // Phase 1: Normal operation (closed)
    expect(cb.state).toBe("closed");
    const r = await cb.call(ok);
    expect(r.status).toBe(200);

    // Phase 2: Upstream starts failing → trips to open
    await expect(cb.call(fail)).rejects.toThrow();
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe("open");

    // Phase 3: Fast-fail period (no upstream calls)
    await expect(cb.call(ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    // Phase 4: Recovery window elapses → half-open
    vi.advanceTimersByTime(2000);
    expect(cb.state).toBe("half-open");

    // Phase 5: Successful probe → closed
    const probe = await cb.call(ok);
    expect(probe.status).toBe(200);
    expect(cb.state).toBe("closed");

    // Phase 6: Subsequent calls work normally
    const final = await cb.call(ok);
    expect(final.body).toBe("payment processed");
    expect(cb.state).toBe("closed");
  });
});
