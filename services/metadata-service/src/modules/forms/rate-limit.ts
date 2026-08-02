/**
 * Fixed-window rate limiter for the public lead-capture endpoint (LM-002).
 *
 * ── Why this is hand-rolled ──────────────────────────────────────────────────
 * metadata-service has no rate-limit plugin registered in `app.ts`, and the
 * sprint rules forbid adding a dependency. `@fastify/rate-limit` (wrapped by
 * `@civitasone/rate-limit`) is not on this service's dependency list, and its
 * default config allow-lists 127.0.0.1 — which would exempt exactly the traffic
 * the tests need to exercise. So this is a ~60-line in-process limiter with an
 * injectable clock, which is testable and adds nothing to the lockfile.
 *
 * ── What it does and does NOT protect ────────────────────────────────────────
 * Counters live in this process's memory. That means:
 *   ✔ a single pod cannot be flooded by one IP,
 *   ✔ one form cannot be flooded across many IPs (the per-form bucket),
 *   ✘ the limit is PER POD, not fleet-wide. With N replicas an attacker gets N
 *     times the quota, and counters reset on deploy.
 * The gateway (`@fastify/rate-limit` backed by Redis, see
 * services/gateway-service/src/app.ts) is the fleet-wide control, and a gateway
 * rule for this public path is a required follow-up — this limiter is
 * defence-in-depth, not the primary control.
 *
 * Fixed windows (not sliding) are deliberate: memory is O(active keys) with no
 * per-request timestamp list, so the limiter itself cannot be turned into a
 * memory-exhaustion vector. Expired buckets are swept opportunistically, and the
 * key count is hard-capped — when the cap is hit the limiter fails CLOSED
 * (denies) rather than growing without bound.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Max requests per key per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max distinct keys tracked before failing closed. */
  maxKeys?: number;
  /** Injectable clock (ms since epoch) — tests drive time directly. */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(opts: RateLimiterOptions) {
    this.max = opts.max;
    this.windowMs = opts.windowMs;
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Consume one unit against `key`. */
  hit(key: string): RateLimitDecision {
    const t = this.now();
    const existing = this.buckets.get(key);

    if (existing && existing.resetAt > t) {
      if (existing.count >= this.max) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((existing.resetAt - t) / 1000) };
      }
      existing.count += 1;
      return {
        allowed: true,
        remaining: this.max - existing.count,
        retryAfterSeconds: Math.ceil((existing.resetAt - t) / 1000),
      };
    }

    // No bucket, or the previous window has expired → start a fresh window.
    if (!existing && this.buckets.size >= this.maxKeys) {
      this.sweep(t);
      if (this.buckets.size >= this.maxKeys) {
        // Fail closed: refuse rather than let the key map grow unbounded.
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
      }
    }
    this.buckets.set(key, { count: 1, resetAt: t + this.windowMs });
    return { allowed: true, remaining: this.max - 1, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
  }

  /** Drop expired buckets. Called opportunistically when the key cap is reached. */
  sweep(at: number = this.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= at) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Number of tracked keys — for tests and metrics. */
  size(): number {
    return this.buckets.size;
  }

  /** Discard all state. */
  reset(): void {
    this.buckets.clear();
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Per-IP limiter for the public endpoint. Defaults to 10 submissions/minute —
 * generous for a human filling a form, useless for a spam script.
 */
export const publicSubmissionIpLimiter = new FixedWindowRateLimiter({
  max: envInt("METADATA_PUBLIC_FORM_IP_MAX", 10),
  windowMs: envInt("METADATA_PUBLIC_FORM_WINDOW_MS", 60_000),
});

/**
 * Per-form limiter, so a distributed flood against one campaign form is capped
 * even when every request comes from a different IP.
 */
export const publicSubmissionFormLimiter = new FixedWindowRateLimiter({
  max: envInt("METADATA_PUBLIC_FORM_MAX", 300),
  windowMs: envInt("METADATA_PUBLIC_FORM_WINDOW_MS", 60_000),
});
