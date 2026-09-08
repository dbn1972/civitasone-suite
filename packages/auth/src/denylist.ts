/**
 * SEC-006 — session-revocation denylist.
 *
 * Problem: `authPlugin` (plugin.ts) verifies a JWT's signature and expiry
 * only. Revoking a session (identity-service `DELETE /identity/sessions/:id`,
 * or a revoke-all) only flips a Postgres row — it never stops the already
 * -issued access token from continuing to authenticate on EVERY service for
 * up to its remaining lifetime (`accessTokenLifespan` = 3600s today, see
 * `infra/keycloak/civitasone-realm.json`).
 *
 * Fix: a Redis-backed denylist keyed by the JWT `sid` claim (Keycloak's
 * session id — see the token-claims doc-comment in `./index.ts`, mapped to
 * `RequestContext.sessionId` by `toRequestContext`). identity-service writes
 * an entry when a session is revoked; every service's `authPlugin` checks it
 * on every authenticated request, fleet-wide, before trusting the token.
 *
 * Storage: `@civitasone/cache`'s `sharedStore()` — the SAME Redis connection
 * convention (REDIS_URL / CACHE_DRIVER=memory) every service already uses,
 * not a hand-rolled client. This is intentionally NOT the tenant-scoped
 * `Cache` class: a denylist is written by one service and read by every
 * other, so it lives in a shared, un-prefixed-by-service keyspace (see the
 * doc-comment on `sharedStore()`).
 *
 * Fail-open on Redis errors — see `isSessionDenylisted` below for the
 * reasoning; this is a deliberate, documented choice, not an oversight.
 */
import { sharedStore, type CacheStore } from "@civitasone/cache";

const KEY_PREFIX = "session-denylist:sid:";

/**
 * Matches `infra/keycloak/civitasone-realm.json` `accessTokenLifespan`
 * (3600s). Used as the denylist entry's TTL: long enough to cover any token
 * issued under the revoked session (the oldest possible token is at most
 * this many seconds from expiry), short enough that entries self-clean and
 * don't accumulate forever. Configurable via env so an operator retuning the
 * realm's token lifespan doesn't also need a code change to keep them in
 * sync — the two are related but not mechanically linked.
 */
export const ACCESS_TOKEN_LIFESPAN_SECONDS = Number(
  process.env.ACCESS_TOKEN_LIFESPAN_SECONDS ?? 3600,
);

let _store: CacheStore | null = null;
function store(): CacheStore {
  if (!_store) _store = sharedStore();
  return _store;
}

/** Test-only: force a specific store (e.g. MemoryCache) instead of the env-derived default. */
export function __setDenylistStoreForTests(s: CacheStore | null): void {
  _store = s;
}

function keyFor(sid: string): string {
  return `${KEY_PREFIX}${sid}`;
}

/**
 * Record that `sid` is revoked. Called from the identity-service code path
 * that currently just flips the session row's `status` to `revoked`
 * (`sessions/consumer.ts`, both the single-session and revoke-all commands).
 *
 * A missing/empty `sid` is a no-op rather than an error: not every session
 * concept in this codebase is yet backed by a real Keycloak `sid` (see the
 * PR description / SEC-015) and a revoke of such a row has nothing to deny.
 */
export async function denylistSession(
  sid: string | null | undefined,
  ttlSeconds: number = ACCESS_TOKEN_LIFESPAN_SECONDS,
): Promise<void> {
  if (!sid) return;
  await store().set(keyFor(sid), "1", Math.max(1, Math.floor(ttlSeconds)));
}

/**
 * Check whether `sid` has been revoked. Called from `authPlugin` on every
 * authenticated request, fleet-wide — so this function's failure mode has
 * fleet-wide blast radius and the choice below is deliberate:
 *
 * FAIL OPEN on a Redis error (log and treat as "not denylisted").
 *
 * Why not fail closed (reject every request when Redis is unreachable)?
 * `authPlugin` already gates 100% of authenticated traffic across every
 * service. A transient Redis outage — a deploy, a failover, a network
 * blip — would turn into a full platform outage: every user logged out of
 * every service simultaneously, worse than the vulnerability this check
 * closes. The denylist is defense in depth LAYERED ON TOP of signature +
 * expiry verification (which still runs, unconditionally, before this check
 * and is unaffected by a Redis outage) — not the sole gate. A revoked
 * session's token remaining valid for the rest of a brief Redis outage is an
 * acceptable, bounded, and far less damaging failure mode than fail-closed.
 * The check is logged loudly on failure precisely so an outage here is
 * visible to operators (a real, monitorable degradation) rather than a
 * silent, permanent bypass — the two are different: this is a *transient*
 * best-effort check degrading, not a design that quietly never checks.
 */
export async function isSessionDenylisted(
  sid: string | null | undefined,
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<boolean> {
  if (!sid) return false;
  try {
    const v = await store().get(keyFor(sid));
    return v !== null;
  } catch (err) {
    log?.warn(
      { err, sid },
      "SEC-006: session-denylist check failed (Redis unavailable) — failing open, request allowed",
    );
    return false;
  }
}
