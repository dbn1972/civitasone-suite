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
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";

export interface CivitasJwtPayload {
  sub: string;
  tid: string;
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

const algorithm = (process.env.JWT_ALGORITHM ?? "RS256") as "RS256" | "HS256";

export async function verifyJwt(token: string): Promise<CivitasJwtPayload> {
  if (algorithm === "HS256") {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET required when JWT_ALGORITHM=HS256");
    return jwt.verify(token, secret, { algorithms: ["HS256"] }) as CivitasJwtPayload;
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") throw new Error("Invalid JWT structure");

  const publicKey = await getSigningKey(decoded.header);
  const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://civitasone-keycloak:8080";
  const realm = process.env.KEYCLOAK_REALM ?? "civitasone";

  return jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: `${keycloakUrl}/realms/${realm}`,
  }) as CivitasJwtPayload;
}

// ── Sync verify (HS256 only — used in tests) ────────────────────────────────

export function verifyToken(token: string, secret: string): CivitasJwtPayload {
  return jwt.verify(token, secret, { algorithms: ["HS256"] }) as CivitasJwtPayload;
}

// ── Sign (tests / identity-service bootstrap tokens) ────────────────────────

export function signToken(
  payload: Omit<CivitasJwtPayload, "iat" | "exp">,
  secret: string,
  expiresIn: string | number = "1h"
): string {
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn } as jwt.SignOptions);
}

// ── Context extraction ───────────────────────────────────────────────────────

export function toRequestContext(
  payload: CivitasJwtPayload,
  correlationId: string
): RequestContext {
  return {
    tenantId: payload.tid,
    actorId: payload.sub,
    actorType: "user",
    roles: payload.roles ?? [],
    correlationId,
    sessionId: payload.sid ?? payload.sessionId ?? "",
  };
}

// ── RBAC helpers ─────────────────────────────────────────────────────────────

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
