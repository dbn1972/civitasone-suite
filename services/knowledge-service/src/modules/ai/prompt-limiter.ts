/**
 * V4-B-09 — per-actor fixed-window rate limiter for the paid LLM prompt route.
 *
 * In-memory (per process): bounds a single actor's spend per instance. The key is
 * the VERIFIED tenant + actor from the auth context, never a client header.
 */

const WINDOW_MS = 60_000;
const DEFAULT_MAX = 10;
const MAX_TRACKED = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function maxPerWindow(): number {
  const n = Number(process.env.AI_PROMPT_RATE_LIMIT_PER_MIN);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX;
}

/** Returns 0 when the call is allowed, otherwise the seconds until the window resets. */
export function consumePromptQuota(tenantId: string, actorId: string, now = Date.now()): number {
  if (buckets.size >= MAX_TRACKED) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size >= MAX_TRACKED) buckets.clear();
  }
  const key = `${tenantId}:${actorId}`;
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return 0;
  }
  if (b.count >= maxPerWindow()) return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  b.count += 1;
  return 0;
}
