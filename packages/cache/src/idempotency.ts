/**
 * X-Idempotency-Key handling for create commands (UAT T-EDGE bundle 21, TE-09).
 *
 * meeting-service already honours the header by minting the entity id (and the queue
 * messageId) from it with `idempotentId(ctx)`, so a duplicate delivery is dropped by the
 * consumer (markProcessed) and only one row is written. That alone does not tell the
 * client anything, and a REUSED key with a DIFFERENT body was silently treated as the
 * first request. This helper adds the HTTP contract on top, per (scope, tenant, actor,
 * key):
 *
 *   - same key, same body        -> the ORIGINAL response is returned again (replayed)
 *   - same key, different body   -> IdempotencyKeyReusedError (422 IDEMPOTENCY_KEY_REUSED)
 *   - same key while the first request is still running -> waits briefly for its answer,
 *     then IdempotencyInProgressError (409, retryable) if it is still not done
 *   - no key                     -> runs normally
 *
 * A failed first attempt (any thrown error, e.g. a 422 business refusal) releases the
 * key, so the client can correct the request and retry with the same key. The state lives
 * in the shared Redis store (memory store in tests): the answer for 24 hours by default,
 * the in-flight claim only for a short lease (CLAIM_TTL_SECONDS, renewed while the
 * command runs) so a crashed process cannot wedge a key.
 *
 * Fail-OPEN on store errors (Redis down, bad payload): the command just runs without the
 * HTTP replay contract (logged + counted), as the platform does for Redis elsewhere
 * (packages/auth denylist, SEC-006). The consumer dedupe stays the final guard.
 *
 * Callers should ALSO keep minting the entity id with `idempotentId(ctx)` (the meeting
 * pattern): that keeps the consumer-side dedupe as the final guard if the store is lost.
 */
import { createHash } from "node:crypto";
import type { CacheStore } from "./index.js";

export class IdempotencyError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
    this.name = "IdempotencyError";
  }
}

export class IdempotencyKeyReusedError extends IdempotencyError {
  constructor() {
    super(422, "IDEMPOTENCY_KEY_REUSED", "this X-Idempotency-Key was already used for a different request; send a new key for a new request");
  }
}

export class IdempotencyInProgressError extends IdempotencyError {
  constructor() {
    super(409, "IDEMPOTENCY_IN_PROGRESS", "a request with this X-Idempotency-Key is still being processed; try again shortly", true);
  }
}

export type IdempotencyOptions = {
  /** Route / command scope, e.g. "procurement.indent.create". */
  scope: string;
  tenantId: string;
  /** The caller: a key is private to the user who sent it. */
  actorId?: string;
  /** The X-Idempotency-Key header value (undefined = no idempotency). */
  key: string | undefined | null;
  /** The validated request body (hashed; never stored). */
  body: unknown;
  ttlSeconds?: number;
  /** How long a concurrent duplicate waits for the first answer before 409 (ms). */
  waitMs?: number;
  pollMs?: number;
  /** In-flight lease (seconds); renewed every third of it while the command runs. */
  claimTtlSeconds?: number;
  /** Called when the store fails and the request proceeds without idempotency. */
  onStoreError?: (err: unknown) => void;
};

export type IdempotencyResult<T> = { value: T; replayed: boolean };

/** Canonical JSON (sorted object keys, bigint as string) for hashing a body. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const DEFAULT_TTL = 24 * 3600;
/** An in-flight claim survives this long without a heartbeat (crashed owner => key frees up). */
export const CLAIM_TTL_SECONDS = 90;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let storeFailures = 0;
/** Number of requests that ran WITHOUT idempotency because the store failed (metric hook). */
export function idempotencyStoreFailures(): number {
  return storeFailures;
}

/** Run `run` at most once per idempotency key; see the module comment for the contract. */
export async function withIdempotency<T>(store: CacheStore, opts: IdempotencyOptions, run: () => Promise<T>): Promise<IdempotencyResult<T>> {
  const key = typeof opts.key === "string" ? opts.key.trim() : "";
  if (!key) return { value: await run(), replayed: false };

  const ttl = opts.ttlSeconds ?? DEFAULT_TTL;
  const claimTtl = opts.claimTtlSeconds ?? CLAIM_TTL_SECONDS;
  const bodyHash = sha256(canonicalJson(opts.body ?? null));
  const base = `idem:${opts.scope}:${opts.tenantId}:${opts.actorId ?? "-"}:${sha256(key)}`;
  const claimKey = `${base}:claim`;
  const hashKey = `${base}:hash`;
  const respKey = `${base}:resp`;
  let runStarted = false;

  const reportStoreError = (err: unknown) => {
    storeFailures++;
    if (opts.onStoreError) opts.onStoreError(err);
    else console.warn(`[idempotency] store unavailable, proceeding without idempotency for scope ${opts.scope}: ${err instanceof Error ? err.message : String(err)}`);
  };

  const execute = async (): Promise<IdempotencyResult<T>> => {
    // hashKey doubles as the lease: short TTL while running, renewed by the heartbeat.
    await store.set(hashKey, bodyHash, claimTtl);
    const beat = setInterval(() => { void store.set(hashKey, bodyHash, claimTtl).catch(() => undefined); }, Math.max(1, Math.floor((claimTtl * 1000) / 3)));
    beat.unref?.();
    let value: T;
    runStarted = true;
    try {
      value = await run();
    } catch (err) {
      clearInterval(beat);
      // Release the key so a corrected retry with the same key can run.
      await store.del(hashKey).catch(() => undefined);
      await store.del(claimKey).catch(() => undefined);
      throw err;
    }
    clearInterval(beat);
    // The command already ran: a store failure from here on must not turn it into a 500.
    try {
      await store.set(respKey, canonicalJson({ hash: bodyHash, value }), ttl);
      await store.set(hashKey, bodyHash, ttl);
    } catch (err) {
      reportStoreError(err);
      // No complete stored state: drop the answer too (a half-stored answer must not be replayed
      // against a missing hash) and release the key so a retry re-runs (consumer dedupe drops the duplicate).
      await store.del(respKey).catch(() => undefined);
      await store.del(hashKey).catch(() => undefined);
      await store.del(claimKey).catch(() => undefined);
    }
    return { value, replayed: false };
  };

  // Claim won AND nobody holds a live lease (an owner past the claim TTL that is still
  // heartbeating keeps hashKey alive, so it is not taken over).
  const tryAcquire = async (): Promise<boolean> => (await store.incr(claimKey, claimTtl)) === 1 && (await store.get(hashKey)) === null;

  try {
    if (await tryAcquire()) return await execute();

    const deadline = Date.now() + (opts.waitMs ?? 3000);
    const poll = opts.pollMs ?? 50;
    for (;;) {
      const raw = await store.get(respKey);
      if (raw !== null) {
        const stored = JSON.parse(raw) as { hash: string; value: T };
        if (stored.hash !== bodyHash) throw new IdempotencyKeyReusedError();
        return { value: stored.value, replayed: true };
      }
      const heldHash = await store.get(hashKey);
      if (heldHash !== null && heldHash !== bodyHash) throw new IdempotencyKeyReusedError();
      // The first attempt failed and released the key (or its owner died): take it over.
      if (heldHash === null && (await tryAcquire())) return await execute();
      if (Date.now() >= deadline) throw new IdempotencyInProgressError();
      await sleep(poll);
    }
  } catch (err) {
    if (err instanceof IdempotencyError || runStarted) throw err;
    // Store failure before the command started: fail OPEN.
    reportStoreError(err);
    return { value: await run(), replayed: false };
  }
}
