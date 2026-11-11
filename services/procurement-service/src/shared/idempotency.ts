/**
 * UAT T-EDGE bundle 21 (TE-09): X-Idempotency-Key + natural-key duplicate warning for
 * procurement creates (indent, PO, GRN). See packages/cache/src/idempotency.ts.
 */
import { createHash } from "node:crypto";
import { withIdempotency, idempotencyStore, IdempotencyError, canonicalJson } from "@civitasone/cache";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "./context.js";

/** Run a create at most once per X-Idempotency-Key (same key + same body replays the first answer). */
export async function idempotentCreate<T>(ctx: RequestContext, scope: string, body: unknown, run: () => Promise<T>): Promise<T> {
  try {
    const { value } = await withIdempotency(
      idempotencyStore(),
      { scope, tenantId: ctx.tenantId, actorId: ctx.actorId, key: ctx.idempotencyKey, body },
      run,
    );
    return value;
  } catch (err) {
    if (err instanceof IdempotencyError) throw new HttpError(err.status, err.code, err.message);
    throw err;
  }
}

export type DuplicateWarning = { code: string; message: string };

/**
 * Natural-key duplicate WARNING (not a block): true when the same maker submitted the
 * same natural key (e.g. indent purpose + items) within the same minute. Fails open
 * (no warning) when the store is unavailable.
 */
export async function isLikelyDuplicate(ctx: RequestContext, scope: string, naturalKey: unknown, now = Date.now()): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  const hash = createHash("sha256").update(canonicalJson(naturalKey)).digest("hex");
  try {
    return (await idempotencyStore().incr(`dup:${scope}:${ctx.tenantId}:${ctx.actorId}:${minute}:${hash}`, 120)) > 1;
  } catch {
    return false;
  }
}
