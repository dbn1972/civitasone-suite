/**
 * @civitasone/circuit-breaker
 *
 * Minimal, zero-dependency circuit breaker implementation (SC-6).
 *
 * State machine:
 *   closed  ──(N consecutive failures)──▶  open
 *   open    ──(recoveryMs elapsed)───────▶  half-open
 *   half-open ──(success)─────────────────▶  closed
 *   half-open ──(failure)─────────────────▶  open   (reset timer)
 *
 * "Failure window" here is N CONSECUTIVE failures: the failure count resets to
 * zero on any successful call while the breaker is closed. For most microservice
 * patterns this is the simplest approach and avoids the need for a sliding
 * time-window counter.
 */

export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Logical name used in error messages. */
  name: string;
  /** Number of consecutive failures before the breaker trips to open. */
  failureThreshold: number;
  /** Milliseconds to wait in the open state before moving to half-open. */
  recoveryMs: number;
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — calls are rejected until recovery window elapses`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private _state: CircuitBreakerState = "closed";
  private _failures = 0;
  private _openedAt: number | null = null;

  constructor(private readonly opts: CircuitBreakerOptions) {
    if (opts.failureThreshold < 1) throw new RangeError("failureThreshold must be >= 1");
    if (opts.recoveryMs < 0) throw new RangeError("recoveryMs must be >= 0");
  }

  /** Current state of the circuit breaker. */
  get state(): CircuitBreakerState {
    // Lazily transition open → half-open once the recovery window has elapsed.
    if (this._state === "open" && this._openedAt !== null) {
      if (Date.now() - this._openedAt >= this.opts.recoveryMs) {
        this._state = "half-open";
      }
    }
    return this._state;
  }

  /**
   * Execute `fn` through the circuit breaker.
   *
   * - If the breaker is **open**, throws {@link CircuitBreakerOpenError} immediately.
   * - If the breaker is **half-open**, executes one probe call:
   *   - success → trips back to closed (failure count reset)
   *   - failure → trips back to open (recovery timer reset)
   * - If the breaker is **closed**, executes normally:
   *   - success → resets the consecutive failure counter
   *   - failure → increments counter; trips to open when threshold is reached
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state; // triggers lazy open→half-open transition

    if (currentState === "open") {
      throw new CircuitBreakerOpenError(this.opts.name);
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  private _onSuccess(): void {
    this._failures = 0;
    this._openedAt = null;
    this._state = "closed";
  }

  private _onFailure(): void {
    this._failures++;
    if (this._state === "half-open" || this._failures >= this.opts.failureThreshold) {
      this._state = "open";
      this._openedAt = Date.now();
      this._failures = 0; // reset so the count starts fresh after recovery
    }
  }
}
