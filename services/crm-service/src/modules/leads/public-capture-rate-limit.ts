/**
 * Rate limiter for the LM-002 PUBLIC lead-capture endpoint.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * FAIL CLOSED. This is the OPPOSITE of the graceful-degradation rule used everywhere
 * else in this codebase, and the reason has to be recorded or someone will "fix" it.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * The standing rule is: if Redis is down, fall through to the database, log WARN, never
 * 500 (see field-rules-repo.listRules for the canonical example). That rule is correct
 * for an AUTHENTICATED read — the caller is known, the blast radius is one user's
 * latency, and refusing service would be worse than serving it slowly.
 *
 * It is wrong here. This endpoint is an unauthenticated write. The limiter is not a
 * performance optimisation whose absence merely makes things slower; it is the ONLY
 * thing standing between a public URL and an unbounded insert loop. Degrading it open
 * turns a Redis outage into "anyone may write as many lead rows as they like", i.e. a
 * cache outage escalates into a database-exhaustion vector and a spam firehose into
 * every tenant's CRM. So a limiter that cannot answer refuses the request (429) and
 * logs WARN.
 *
 * The cost of failing closed is bounded and recoverable: while Redis is down, public
 * forms stop accepting leads and prospects see "please retry later". The cost of
 * failing open is not recoverable — the junk rows are already in the tenant's CRM.
 *
 * ── TWO dimensions, and why neither alone is enough ─────────────────────────────
 * Per (form, client IP)  — stops one host hammering one form.
 * Per tenant             — stops a distributed flood (a botnet with a fresh IP per
 *                          request never trips a per-IP counter at all).
 *
 * A per-TENANT limit on its own is a denial-of-service weapon: one attacker burns the
 * tenant's whole budget and every genuine prospect is refused. So the per-IP counter
 * is charged FIRST and a request refused there never touches the tenant counter —
 * an abusive IP therefore cannot consume the shared budget. The tenant counter is a
 * ceiling on aggregate damage, not the primary control.
 *
 * ── Window ──────────────────────────────────────────────────────────────────────
 * Fixed 60s window, with the minute bucket baked INTO the key. That matters: a sliding
 * key whose TTL is refreshed on every increment would never expire under sustained
 * traffic, so an attacker could lock a form out permanently. With the bucket in the key
 * the counter simply stops being addressed when the minute rolls over.
 *
 * ── Atomicity ───────────────────────────────────────────────────────────────────
 * @civitasone/cache does not expose Redis INCR, and this service must not open a second
 * Redis client (one cache singleton, per the architecture rules). So the increment is a
 * read-modify-write through the cache. Under genuine concurrency that can undercount and
 * admit a few extra requests inside one window. Accepted: this is a coarse abuse control,
 * not a correctness boundary — nothing downstream depends on the count being exact, and
 * the create-or-update on the tenant's email index means duplicate submissions converge
 * on one row anyway. If exactness is ever needed, add an `incr()` to @civitasone/cache
 * rather than a second client here.
 */
import type { FastifyRequest } from "fastify";
import { pino } from "pino";
import { cache } from "../../shared/infra.js";

const log = pino({ name: "crm-public-capture-rate-limit" });

/** Fixed window length. 60s because max_per_minute is expressed per minute. */
export const WINDOW_SECONDS = 60;

/** Cache resource segment for limiter keys — namespaced away from real read caches. */
const RESOURCE = "public_capture_rl";

/**
 * Aggregate ceiling for ONE tenant across ALL of its public forms, per 60s window.
 * Deliberately generous relative to a single form's budget: it is a backstop against a
 * distributed flood, not the control that shapes normal traffic. Configurable because a
 * tenant running a national campaign legitimately spikes.
 */
const DEFAULT_TENANT_MAX_PER_MINUTE = 600;

function tenantCeiling(formMaxPerMinute: number): number {
  const raw = Number(process.env.CRM_PUBLIC_CAPTURE_TENANT_MAX_PER_MINUTE);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TENANT_MAX_PER_MINUTE;
  // Never below the per-form/per-IP budget: a tenant ceiling tighter than the per-IP
  // budget would make the per-IP budget unreachable and silently become the real limit,
  // which is the DoS shape this design exists to avoid.
  return Math.max(configured, formMaxPerMinute);
}

/**
 * Counter keys are not tenant-scoped in the cache-key sense: the limit has to be applied
 * BEFORE we would trust anything, and the form key already implies the tenant. The literal
 * "public" segment keeps `cache.makeKey`'s {service}:{tenant}:{resource}:{id}
 * convention intact without pretending a tenant was authenticated.
 */
function windowKey(discriminator: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / (WINDOW_SECONDS * 1000));
  return cache.makeKey("public", RESOURCE, `${discriminator}:${bucket}`);
}

export interface RateLimitDecision {
  allowed: boolean;
  /** True when the decision was a fail-closed refusal rather than a real overage. */
  limiterUnavailable: boolean;
  /** Which budget refused the request. `null` when it was allowed. */
  scope: "ip" | "tenant" | null;
}

/**
 * ── x-forwarded-for trust ───────────────────────────────────────────────────────
 *
 * Fastify is built WITHOUT `trustProxy` (see app.ts), so `req.ip` is the socket peer
 * address and `x-forwarded-for` is ignored by the framework. Behind the gateway that
 * makes every submission look like it came from the gateway, which would collapse the
 * per-IP budget into a single shared counter — and a shared counter is precisely the
 * tenant-wide DoS this module is trying not to build.
 *
 * So the header is consulted, but ONLY as far as the operator says it is trustworthy:
 *
 *   TRUSTED_PROXY_HOPS = 0 (default)  ignore the header entirely, use the socket peer.
 *   TRUSTED_PROXY_HOPS = n           trust the last n entries as proxy-appended.
 *
 * Why the LAST hop and not the first: each well-behaved proxy APPENDS the address it
 * received the connection from. A client that sends its own `x-forwarded-for: 1.2.3.4`
 * gets that value kept at the FRONT of the list, so `list[0]` is entirely attacker
 * controlled — reading it would let anyone mint a fresh "IP" per request and walk
 * straight past the limiter. With n trusted proxies, `list[list.length - n]` is the
 * address the outermost TRUSTED proxy observed, which the client cannot influence.
 *
 * Default 0 because the unsafe direction here is trusting a header nobody is rewriting:
 * a service accidentally exposed directly to the internet must not honour a
 * self-declared IP. A deployment behind the CivitasOne gateway / an ALB sets
 * TRUSTED_PROXY_HOPS=1 (see .env.example). With the default, per-IP and per-tenant
 * budgets coincide — which is why the per-tenant ceiling is generous and the per-form
 * `max_per_minute` is the number an operator actually tunes.
 */
export function resolveClientIp(req: Pick<FastifyRequest, "ip" | "headers">): string {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS);
  const hops = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  if (hops === 0) return req.ip;

  const header = req.headers["x-forwarded-for"];
  // Fastify hands back string[] when the header is repeated; joining is what a single
  // comma-separated header would have been, so both spellings parse identically.
  const joined = Array.isArray(header) ? header.join(",") : header;
  if (typeof joined !== "string" || joined.trim() === "") return req.ip;

  const list = joined.split(",").map((v) => v.trim()).filter((v) => v !== "");
  if (list.length === 0) return req.ip;
  // Clamp: fewer hops present than configured means the header was not written by the
  // full trusted chain, so fall back to the earliest entry we have rather than reading
  // past the start of the array (noUncheckedIndexedAccess makes that a type error too).
  const index = Math.max(0, list.length - hops);
  return list[index] ?? req.ip;
}

/**
 * Count this request against one budget and decide whether to serve it.
 * `limit` always comes from server-side configuration, never from the caller.
 */
async function charge(
  discriminator: string,
  limit: number,
  nowMs: number,
): Promise<{ allowed: boolean; limiterUnavailable: boolean }> {
  const key = windowKey(discriminator, nowMs);
  try {
    // getOrLoad with a null-returning loader is a read-only peek: a miss caches nothing.
    const current = await cache.getOrLoad<number>(key, async () => null);
    const used = typeof current === "number" && Number.isFinite(current) ? current : 0;
    if (used >= limit) return { allowed: false, limiterUnavailable: false };
    // TTL slightly over the window so the key cannot outlive its bucket by more than
    // one window even if the clock drifts.
    await cache.put(key, used + 1, WINDOW_SECONDS + 5);
    return { allowed: true, limiterUnavailable: false };
  } catch (err) {
    // No client IP, no form key in the log line: the form key is a bearer secret, so it
    // is NOT logged, and the IP is not needed to diagnose "Redis is down".
    log.warn({ err }, "public lead capture rate limiter unavailable — failing closed (429)");
    return { allowed: false, limiterUnavailable: true };
  }
}

export interface CaptureRateLimitTarget {
  /** Bearer-secret form key. Used only as an opaque counter discriminator, never logged. */
  formKey: string;
  tenantId: string;
  clientIp: string;
  /** The form's own per-IP budget, from the DB (CHECK-bounded 1..600). */
  maxPerMinute: number;
}

/**
 * Charge both budgets for one public submission. Per-IP first — see the header for why
 * a refusal there must not touch the tenant counter.
 */
export async function checkCaptureRateLimit(
  target: CaptureRateLimitTarget,
  nowMs: number = Date.now(),
): Promise<RateLimitDecision> {
  const perIp = await charge(
    `ip:${target.formKey}:${target.clientIp}`,
    target.maxPerMinute,
    nowMs,
  );
  if (!perIp.allowed) return { ...perIp, scope: "ip" };

  const perTenant = await charge(
    `tenant:${target.tenantId}`,
    tenantCeiling(target.maxPerMinute),
    nowMs,
  );
  if (!perTenant.allowed) return { ...perTenant, scope: "tenant" };

  return { allowed: true, limiterUnavailable: false, scope: null };
}
