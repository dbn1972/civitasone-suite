/**
 * gap module — peer-service client for the routes that fixed COMP-001.
 *
 * Several of the 21 previously-fabricated routes in this module have a real
 * backing store already — it just lives in another service (identity-service
 * RBAC/users, audit-service events, tenant-service quotas), not admin-service.
 *
 * IMPORTANT (security): this forwards the ORIGINAL CALLER'S bearer token, not
 * an x-internal/INTERNAL_SERVICE_SECRET service-account call. The identity-
 * service RBAC routes (rbac/commands.ts) run real anti-self-escalation checks
 * (assertCanConfer/assertKeyAllowed) keyed off the ACTOR's own roles and
 * effective permissions. The x-internal seam used elsewhere in this codebase
 * (see lead-ingestion/crm-client.ts) resolves to a synthetic service-account
 * context with roles: ["super_admin", "hr_admin", "payroll_admin",
 * "finance_admin"] (packages/auth/src/context.ts) — using it here would let
 * ANY caller admin-service itself lets through (tenant_admin included) act
 * with super_admin RBAC authority at identity-service, bypassing the very
 * self-escalation guard those commands exist to enforce. Token-forwarding
 * instead makes identity-service re-derive the REAL actor and apply its own
 * checks, which is both simpler and the only safe option for a write path.
 */
import type { FastifyRequest } from "fastify";
import { HttpError } from "../../shared/context.js";

export interface UpstreamCtx {
  tenantId: string;
  correlationId: string;
}

export interface UpstreamResult<T> {
  status: number;
  body: T;
}

/**
 * Forward the caller's Authorization header (+ tenant/correlation) to a peer
 * service and return its raw status + parsed body. Never throws on a non-2xx
 * upstream response (the caller decides how to translate it) — only throws
 * HttpError for a genuinely missing token or a transport failure, both of
 * which are real "we could not honestly answer" conditions (502), never a
 * fabricated 2xx.
 */
export async function callUpstream<T = unknown>(
  req: FastifyRequest,
  ctx: UpstreamCtx,
  method: string,
  baseUrl: string,
  path: string,
  body?: unknown,
): Promise<UpstreamResult<T>> {
  const auth = req.headers.authorization;
  if (!auth) {
    // Every route in this module already ran resolveContext()+requireRole()
    // on the incoming request before reaching here, so this should be
    // unreachable in practice (HS256 test tokens and Keycloak RS256 tokens
    // both arrive as a Bearer header) — it is a defensive 502, not a 401,
    // because the CALLER is authenticated; it is OUR forward that failed.
    throw new HttpError(502, "UPSTREAM_UNAUTHENTICATED", "no caller bearer token available to forward upstream");
  }
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  let res: Response;
  try {
    res = await (globalThis.fetch as typeof fetch)(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: auth,
        "x-tenant-id": ctx.tenantId,
        "x-correlation-id": ctx.correlationId,
      },
      // exactOptionalPropertyTypes: RequestInit.body must be omitted entirely
      // for a bodyless request — `body: undefined` is a type error.
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(Number(process.env.GAP_UPSTREAM_TIMEOUT_MS ?? 10000)),
    });
  } catch (err) {
    throw new HttpError(502, "UPSTREAM_UNAVAILABLE", `upstream call to ${path} failed: ${(err as Error).message}`);
  }
  const text = await res.text();
  let parsed: unknown;
  if (text.length > 0) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: res.status, body: parsed as T };
}

export function identityBaseUrl(): string {
  return process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";
}
export function auditBaseUrl(): string {
  return process.env.AUDIT_SERVICE_URL ?? "http://127.0.0.1:3004";
}
export function tenantServiceBaseUrl(): string {
  return process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002";
}

/** Relay an upstream error body/status as this route's own response, honestly. */
export function relayError(status: number, body: unknown): { status: number; payload: unknown } {
  if (body && typeof body === "object") return { status, payload: body };
  return { status, payload: { code: "UPSTREAM_ERROR", message: typeof body === "string" ? body : "upstream error" } };
}
