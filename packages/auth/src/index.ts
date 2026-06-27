/**
 * @civitasone/auth
 *
 * Keycloak OIDC / RS256 JWT verification for all services.
 * In tests (NODE_ENV=test or JWT_ALGORITHM=HS256) falls back to a shared HS256 secret
 * so test suites don't need a running Keycloak.
 *
 * Environment variables consumed:
 *   KEYCLOAK_URL     — e.g. http://civitasone-keycloak:8080  (required in prod)
 *   KEYCLOAK_REALM   — e.g. civitasone                       (default: civitasone)
 *   JWT_ALGORITHM    — RS256 | HS256                         (default: RS256)
 *   JWT_SECRET       — shared secret when JWT_ALGORITHM=HS256 (tests only)
 *
 * Token claims expected (set via Keycloak protocol mappers):
 *   sub   — Keycloak user UUID
 *   tid   — tenantId (custom claim via user attribute mapper)
 *   roles — string[] from realm-roles-mapper
 *   sid   — Keycloak session ID
 */

import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import { randomUUID as cryptoRandomUUID, createHash as cryptoCreateHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";

export interface CivitasJwtPayload {
  sub: string;
  tid?: string;
  /** Dev/test tokens may use tenantId instead of tid */
  tenantId?: string;
  roles: string[];
  sid?: string;
  sessionId?: string;
  iat: number;
  exp: number;
  iss?: string;
}

export type { RequestContext };

// ── JWKS client (singleton, cached) ─────────────────────────────────────────

let _jwksClient: jwksRsa.JwksClient | null = null;

function getJwksClient(): jwksRsa.JwksClient {
  if (_jwksClient) return _jwksClient;
  const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://civitasone-keycloak:8080";
  const realm = process.env.KEYCLOAK_REALM ?? "civitasone";
  _jwksClient = jwksRsa({
    jwksUri: `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`,
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 600_000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
  return _jwksClient;
}

// ── Key resolver for RS256 ───────────────────────────────────────────────────

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!header.kid) return reject(new Error("JWT missing kid header"));
    getJwksClient().getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key!.getPublicKey());
    });
  });
}

// ── Core verify ─────────────────────────────────────────────────────────────

/**
 * SEC-1: HS256 (shared-secret) auth is forbidden in production. The dev/test
 * shared secret (`civitasone-dev-secret`) was used to forge a super_admin token.
 * In production we verify exclusively against the Keycloak JWKS (RS256); any
 * attempt to run HS256 in prod is a fatal misconfiguration, not a silent fallback.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function resolveAlgorithm(): "RS256" | "HS256" {
  const configured = (process.env.JWT_ALGORITHM ?? "RS256") as "RS256" | "HS256";
  if (isProduction() && configured === "HS256") {
    throw new Error(
      "SEC-1: JWT_ALGORITHM=HS256 is forbidden in production. Use RS256/Keycloak.",
    );
  }
  return configured;
}

export async function verifyJwt(token: string): Promise<CivitasJwtPayload> {
  const algorithm = resolveAlgorithm();

  if (algorithm === "HS256") {
    // Reachable only in non-production (resolveAlgorithm throws in prod).
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET required when JWT_ALGORITHM=HS256");
    return jwt.verify(token, secret, { algorithms: ["HS256"] }) as CivitasJwtPayload;
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") throw new Error("Invalid JWT structure");

  const publicKey = await getSigningKey(decoded.header);
  const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://civitasone-keycloak:8080";
  const realm = process.env.KEYCLOAK_REALM ?? "civitasone";

  // SAST-004 (CWE-287): validate the token audience on the RS256/prod path
  // (the HS256 dev/test path already validates aud). Prefer JWT_AUDIENCE, then
  // the Keycloak client id. In production an unset audience is a fail-closed
  // misconfiguration; outside production we skip aud validation so local dev
  // and tests that omit the claim are unaffected.
  const audience = process.env.JWT_AUDIENCE ?? process.env.KEYCLOAK_CLIENT_ID;
  if (isProduction() && !audience) {
    throw new Error(
      "SAST-004: JWT_AUDIENCE (or KEYCLOAK_CLIENT_ID) must be set in production to validate token audience.",
    );
  }

  return jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: `${keycloakUrl}/realms/${realm}`,
    ...(audience ? { audience } : {}),
  }) as CivitasJwtPayload;
}

// ── Sync verify (HS256 only — used in tests) ────────────────────────────────

export function verifyToken(token: string, secret: string): CivitasJwtPayload {
  // SEC REM-06: validate issuer and audience on the HS256 dev/test path as
  // defense-in-depth. Prevents tokens with wrong iss/aud from being accepted
  // even in non-production environments.
  const issuer  = process.env.HS256_TOKEN_ISSUER  ?? "civitasone-dev";
  const audience = process.env.HS256_TOKEN_AUDIENCE ?? "civitasone";
  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer,
    audience,
  }) as CivitasJwtPayload;
}

// ── Sign (tests / identity-service bootstrap tokens) ────────────────────────

export function signToken(
  payload: Omit<CivitasJwtPayload, "iat" | "exp">,
  secret: string,
  expiresIn: string | number = "1h"
): string {
  // SEC REM-06: embed the default iss/aud so tokens produced here are accepted
  // by verifyToken (which now validates issuer + audience as defense-in-depth).
  const issuer  = process.env.HS256_TOKEN_ISSUER  ?? "civitasone-dev";
  const audience = process.env.HS256_TOKEN_AUDIENCE ?? "civitasone";
  return jwt.sign(
    { iss: issuer, aud: audience, ...payload },
    secret,
    { algorithm: "HS256", expiresIn } as jwt.SignOptions,
  );
}

// ── Context extraction ───────────────────────────────────────────────────────

export function toRequestContext(
  payload: CivitasJwtPayload,
  correlationId: string,
  headerTenantId?: string,
): RequestContext {
  // SEC-2: for a real JWT the tenant MUST come from the signed token (tid claim).
  // The x-tenant-id header is attacker-controllable; only honour it as a fallback
  // outside production (dev/test tokens that omit tid).
  const trustedHeaderTenant =
    process.env.NODE_ENV === "production" ? undefined : headerTenantId;
  const tenantId = payload.tid ?? payload.tenantId ?? trustedHeaderTenant ?? "";
  return {
    tenantId,
    actorId: payload.sub,
    actorType: "user",
    roles: payload.roles ?? [],
    correlationId,
    sessionId: payload.sid ?? payload.sessionId ?? "",
  };
}

// ── RBAC helpers ─────────────────────────────────────────────────────────────

/**
 * EVT-4 (04-T4): derive a stable id from a client idempotency key so a
 * double-submit produces the same messageId/entity id and dedupes at the
 * consumer (`_inbox.processed`). Falls back to a random UUID when no key is set.
 */
export function idempotentId(ctx: { idempotencyKey?: string }): string {
  if (!ctx.idempotencyKey) return cryptoRandomUUID();
  const h = cryptoCreateHash("sha256").update(ctx.idempotencyKey).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function hasAnyRole(ctx: RequestContext, required: string[]): boolean {
  return required.some((r) => ctx.roles.includes(r));
}

export function hasAllRoles(ctx: RequestContext, required: string[]): boolean {
  return required.every((r) => ctx.roles.includes(r));
}

/** Prefer ctx set by authPlugin; fall back for tests without plugin. */
export function contextFromRequest(req: FastifyRequest): RequestContext | null {
  const ctx = (req as FastifyRequest & { ctx?: RequestContext }).ctx;
  if (!ctx || ctx.actorId === "system") return null;
  return ctx;
}
