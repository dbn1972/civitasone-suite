/**
 * W1.4 — API Key authentication path for the gateway.
 *
 * Checks the x-api-key header, resolves the key from identity-service,
 * verifies scopes, and injects tenant context into the request.
 *
 * Flow:
 *   1. Extract x-api-key header
 *   2. Hash the presented key (SHA-256)
 *   3. Look up the key record by hash from identity-service (or cache)
 *   4. Verify the key is active + not expired
 *   5. Check that the key's scopes cover the requested resource:action
 *   6. Inject x-tenant-id and x-actor-id (from key owner) into the upstream request
 *
 * If no x-api-key header is present, this middleware is a no-op (JWT path proceeds).
 */
import { createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

interface ApiKeyRecord {
  id: string;
  tenantId: string;
  ownerId: string;
  scopes: string[];
  status: "active" | "rotated" | "revoked";
  expiresAt: string | null;
}

// In-memory cache (production should use Redis via @civitasone/cache)
const keyCache = new Map<string, { record: ApiKeyRecord; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function resolveKeyRecord(keyHash: string): Promise<ApiKeyRecord | null> {
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
        "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
      },
      body: JSON.stringify({ keyHash }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;
    const record = (await res.json()) as ApiKeyRecord;
    keyCache.set(keyHash, { record, cachedAt: Date.now() });
    return record;
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

  const keyHash = sha256Hex(apiKey);
  const record = await resolveKeyRecord(keyHash);

  if (!record) {
    reply.code(401).send({ error: { code: "INVALID_API_KEY", message: "API key not found or invalid" } });
    return;
  }

  // Check status
  if (record.status !== "active") {
    reply.code(401).send({ error: { code: "API_KEY_INACTIVE", message: `API key is ${record.status}` } });
    return;
  }

  // Check expiry
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    reply.code(401).send({ error: { code: "API_KEY_EXPIRED", message: "API key has expired" } });
    return;
  }

  // Check scope
  const requiredScope = deriveRequiredScope(req.method, req.url);
  if (!scopeCovers(record.scopes, requiredScope)) {
    reply.code(403).send({ error: { code: "SCOPE_DENIED", message: `API key lacks scope '${requiredScope}'` } });
    return;
  }

  // Inject tenant context for upstream services
  (req.headers as Record<string, string>)["x-tenant-id"] = record.tenantId;
  (req.headers as Record<string, string>)["x-actor-id"] = record.ownerId;
  (req.headers as Record<string, string>)["x-auth-method"] = "api-key";

  // Mark as authenticated (skip JWT check downstream)
  (req as any).apiKeyAuthenticated = true;
}
