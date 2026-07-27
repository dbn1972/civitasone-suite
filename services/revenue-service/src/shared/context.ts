import type { FastifyRequest } from "fastify";
// Matches finance-service exactly (services/finance-service/src/shared/context.ts)
// so the auth-context behaviour cannot drift between services again.
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Re-exported from @civitasone/types rather than declared locally.
 *
 * This service previously defined its OWN structurally-similar RequestContext,
 * which made it incompatible with the shared `resolveServiceContext()` return
 * type. Declaring a private copy of a shared contract is what let this service's
 * auth wiring drift from the rest of the fleet in the first place. Re-exporting
 * keeps existing `import { RequestContext } from "../../shared/context.js"`
 * call sites working while binding this service to the single shared definition.
 */
export type { RequestContext } from "@civitasone/types";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Resolve the authenticated request context.
 *
 * BUG FIXED 2026-07-27: this previously read `(req as any).user`, which the auth
 * plugin never sets — it decorates `req.ctx` (packages/auth/src/plugin.ts:62).
 * `user` was therefore always undefined, so EVERY authenticated route in this
 * service returned 401 "missing authentication". Confirmed against the running
 * service: GET /v1/revenue/analytics/defaulters returned 401 with a valid HS256
 * token that finance-service accepted on the same host.
 *
 * It went unnoticed because eight test files `vi.mock`ed this very module and
 * substituted a working resolveContext that read `req.ctx` — so the suite
 * reported 99.6% line coverage while never exercising the real code path. The
 * mocks have been removed alongside this fix.
 *
 * Now delegates to the shared `resolveServiceContext`, matching finance-service
 * and the rest of the fleet, so the behaviour cannot drift again.
 */
export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    const ctx = resolveServiceContext(req);
    if (!ctx.tenantId || !UUID_RE.test(ctx.tenantId)) {
      throw new HttpError(401, "UNAUTHENTICATED", "missing or malformed tenant context");
    }
    return ctx;
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/**
 * `ctx.roles` is coalesced to `[]` deliberately, so an absent roles claim FAILS
 * CLOSED with 403 rather than throwing a TypeError and surfacing as a 500.
 * The shared resolver does not default the field, and a 500 on an authz check is
 * both a worse client contract and harder to spot in logs than a clean denial.
 */
export function requireRole(ctx: RequestContext, allowed: string[]): void {
  const has = (ctx.roles ?? []).some((r) => allowed.includes(r));
  if (!has) throw new HttpError(403, "FORBIDDEN", "insufficient role");
}
