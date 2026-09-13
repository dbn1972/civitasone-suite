/**
 * W1.4 — API Key authentication path for the gateway.
 *
 * Checks the x-api-key header, resolves the key from identity-service,
 * verifies scopes, and injects tenant context into the request.
 *
 * Flow:
 *   1. Extract x-api-key header
 *   2. Look up the key by raw value from identity-service (or cache, keyed
 *      by our own local hash of it)
 *   3. Trust identity-service's verdict on active/not-expired (it already
 *      enforces this before returning valid:true -- see SEC-024 below)
 *   4. Check that the key's scopes cover the requested resource:action
 *   5. Inject x-tenant-id and x-actor-id (from key owner) into the upstream request
 *
 * If no x-api-key header is present, this middleware is a no-op (JWT path proceeds).
 */
import { createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

// Shape returned by identity-service's POST /internal/apikeys/verify -- mirrors
// identity-service's modules/apikeys/commands.ts VerifyResult exactly (this is
// a cross-service wire contract, not a locally-invented shape; keep it in sync
// with that type). identity-service already enforces active/not-expired/scope
// internally (isUsable() + assertScope() inside verifyApiKey) and folds any
// failure into valid:false + reason, so this side only needs to trust `valid`
// -- it must NOT re-derive status/expiry itself.
//
// SEC-024: the previous shape here (`ApiKeyRecord`: id/tenantId/ownerId/
// scopes/status/expiresAt) never matched anything identity-service actually
// returns. Even once the URL and auth were fixed, `record.status` would have
// been undefined on every response -- undefined !== "active" -- so EVERY key,
// valid or not, would have been rejected as API_KEY_INACTIVE. That dead
// status/expiresAt re-check is removed below rather than patched to match,
// since identity-service is the source of truth for validity and already
// performs that check server-side.
interface VerifyKeyResult {
  valid: boolean;
  apiKeyId?: string;
  tenantId?: string;
  ownerId?: string;
  scopes?: string[];
  reason?: string;
}

// In-memory cache (production should use Redis via @civitasone/cache)
const keyCache = new Map<string, { record: VerifyKeyResult; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * SEC-024: this was fetching `${IDENTITY_URL}/internal/apikeys/verify` with a
 * pre-hashed `{ keyHash }` body and only an `x-internal-secret` header -- but
 * identity-service never registered anything at that path (only the
 * ADMIN-role-gated `/identity/api-keys/verify`, which also requires a
 * pre-known ctx.tenantId the gateway cannot supply before verification even
 * succeeds -- it needs the tenant TOLD to it by this very call). So the
 * verify call 404d for every request and `apiKeyAuthenticated` could never be
 * set to true, valid key or not.
 *
 * This call is the gateway calling a downstream service directly on its own
 * behalf (not proxying an already-authenticated user request) -- exactly the
 * scenario `assertGatewayRequest` (packages/auth/src/plugin.ts) exists for.
 * identity-service now registers a matching internal-only route
 * (modules/apikeys/internal-routes.ts) guarded by it. Two things were wrong
 * with the request, not just the path: the missing `x-gateway-request: "1"`
 * header assertGatewayRequest also requires (x-internal-secret alone was
 * already correctly named for this mechanism), and the body -- identity's
 * verifyApiKeyBody/verifyApiKey hash the RAW presented key themselves, so
 * this must send `{ key }`, not a pre-computed `{ keyHash }`. The local
 * `keyCache` below stays keyed by our own hash purely for in-memory dedup;
 * that hash never leaves this process.
 */
async function resolveKeyRecord(apiKey: string): Promise<VerifyKeyResult | null> {
  const keyHash = sha256Hex(apiKey);

  // Check cache first
  const cached = keyCache.get(keyHash);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.record;
  }

  // Call identity-service internal API
  try {
    const res = await fetch(`${IDENTITY_URL}/internal/apikeys/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gateway-request": "1",
        "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
      },
      body: JSON.stringify({ key: apiKey }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;
    const result = (await res.json()) as VerifyKeyResult;
    if (!result.valid) return null;
    keyCache.set(keyHash, { record: result, cachedAt: Date.now() });
    return result;
  } catch {
    return null; // fail-closed: unresolvable key = denied
  }
}

function scopeMatches(granted: string, required: string): boolean {
  const [gRes, gAct] = granted.split(":");
  const [rRes, rAct] = required.split(":");
  return (gRes === "*" || gRes === rRes) && (gAct === "*" || gAct === rAct);
}

function scopeCovers(grantedScopes: string[], requiredScope: string): boolean {
  return grantedScopes.some((g) => scopeMatches(g, requiredScope));
}

/**
 * Derive the required scope from the request method + path.
 * Convention: resource = first path segment after /v1/, action = HTTP method mapping.
 */
function deriveRequiredScope(method: string, url: string): string {
  const match = url.match(/\/v1\/([^/]+)/);
  const resource = match?.[1] ?? "unknown";
  const actionMap: Record<string, string> = {
    GET: "read", HEAD: "read",
    POST: "write", PUT: "write", PATCH: "write", DELETE: "write",
  };
  const action = actionMap[method.toUpperCase()] ?? "read";
  return `${resource}:${action}`;
}

/**
 * Fastify preHandler hook for API key authentication.
 * Runs before the JWT auth — if x-api-key is present, handles auth entirely.
 */
export async function apiKeyPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (!apiKey) return; // no API key → fall through to JWT auth

  const record = await resolveKeyRecord(apiKey);

  if (!record) {
    reply.code(401).send({ error: { code: "INVALID_API_KEY", message: "API key not found or invalid" } });
    return;
  }

  // Check scope. (Active/not-expired is already enforced by identity-service
  // itself -- see resolveKeyRecord's comment -- so there is no separate
  // status/expiresAt check here anymore.)
  const requiredScope = deriveRequiredScope(req.method, req.url);
  if (!record.scopes || !scopeCovers(record.scopes, requiredScope)) {
    reply.code(403).send({ error: { code: "SCOPE_DENIED", message: `API key lacks scope '${requiredScope}'` } });
    return;
  }

  // Inject tenant context for upstream services
  (req.headers as Record<string, string>)["x-tenant-id"] = record.tenantId ?? "";
  (req.headers as Record<string, string>)["x-actor-id"] = record.ownerId ?? "";
  (req.headers as Record<string, string>)["x-auth-method"] = "api-key";

  // Mark as authenticated (skip JWT check downstream)
  (req as any).apiKeyAuthenticated = true;
}
