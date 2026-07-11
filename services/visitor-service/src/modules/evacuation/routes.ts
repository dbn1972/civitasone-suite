/**
 * visitor-service: evacuation HTTP routes.
 *
 * Four endpoints:
 *   GET  /v1/visitor/evacuation/roster   — full roster (emergency, IP-allowlist only)
 *   GET  /v1/visitor/evacuation/count    — headcount   (emergency, IP-allowlist only)
 *   POST /v1/visitor/evacuation/declare  — declare evacuation (standard auth + role)
 *   POST /v1/visitor/evacuation/mark-safe — mark visitor safe (standard auth + role)
 *
 * Requirements 17.2, 17.3:
 *   The GET endpoints bypass standard JWT auth to allow emergency kiosks /
 *   PA systems to pull the roster without Keycloak tokens. Access is gated
 *   via an IP-allowlist read from env `EVACUATION_ALLOWED_IPS` (comma-
 *   separated CIDRs or IPs). Requests from IPs not on the allowlist receive
 *   403 with code `IP_NOT_ALLOWED`.
 *
 * POST endpoints follow the standard route → zod → commands → 202 pattern.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { getFullRoster, getVisitorCount } from "./roster.js";
import { rosterQuery, evacuationDeclareBody, evacuationMarkSafeBody } from "./validators.js";
import * as commands from "./commands.js";

// Roles that can declare evacuations or mark visitors safe — security staff,
// fire wardens, and admin-level roles.
const WRITE_ROLES = ["security_admin", "fire_warden", "tenant_admin", "super_admin"];

// Break-glass roles allowed to pull the (decrypted-PII) evacuation roster /
// headcount. The roster is sensitive PII, so it is NOT anonymous: a valid JWT
// carrying one of these roles is required IN ADDITION to the IP allowlist.
const EMERGENCY_READ_ROLES = ["security_admin", "fire_warden", "gate_terminal", "tenant_admin", "super_admin"];

/**
 * IP-allowlist for the emergency GET endpoints (roster / headcount).
 *
 * `EVACUATION_ALLOWED_IPS` is a comma-separated list of exact IPv4 addresses
 * and/or CIDR ranges (e.g. "10.0.0.5,192.168.1.0/24"). A request is allowed
 * only if the client IP matches an entry.
 *
 * FAIL-CLOSED: when the variable is unset or empty, ALL requests are DENIED
 * (this replaces the previous fail-open "empty = allow all" default, a P0).
 * Production deployments MUST set an explicit allowlist for the break-glass
 * emergency console / PA system. The env is read per-request so the allowlist
 * can be provisioned without a restart.
 */
function parseAllowedRules(): string[] {
  const raw = process.env.EVACUATION_ALLOWED_IPS ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Parse an IPv4 dotted-quad into a 32-bit unsigned int, or null if invalid. */
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  let out = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    out = (out << 8) | octet;
  }
  return out >>> 0;
}

/** True if `ip` matches `rule` — either an exact IPv4 or an `a.b.c.d/len` CIDR. */
function ipMatchesRule(ip: string, rule: string): boolean {
  if (rule.includes("/")) {
    const [net, lenStr] = rule.split("/");
    const len = Number(lenStr);
    const netInt = ipv4ToInt(net ?? "");
    const ipInt = ipv4ToInt(ip);
    if (netInt === null || ipInt === null || !Number.isInteger(len) || len < 0 || len > 32) return false;
    if (len === 0) return true;
    const mask = (0xffffffff << (32 - len)) >>> 0;
    return (netInt & mask) === (ipInt & mask);
  }
  return rule === ip;
}

function getClientIp(req: FastifyRequest): string {
  // Prefer X-Forwarded-For (first entry) from gateway/load balancer, fall
  // back to socket address.
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const raw = Array.isArray(xff) ? xff[0] ?? "" : xff;
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip;
}

function requireAllowedIp(req: FastifyRequest): void {
  const rules = parseAllowedRules();
  // FAIL-CLOSED: no allowlist configured => deny (never allow-all).
  if (rules.length === 0) {
    throw new HttpError(403, "IP_NOT_ALLOWED", "emergency endpoints require a configured IP allowlist");
  }
  const clientIp = getClientIp(req);
  if (!rules.some((rule) => ipMatchesRule(clientIp, rule))) {
    throw new HttpError(403, "IP_NOT_ALLOWED", "request origin is not authorized for emergency endpoints");
  }
}

export async function evacuationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/visitor/evacuation/roster
   * Emergency access (IP-allowlist, no standard auth).
   * Returns full roster for a given location + tenant (query params).
   */
  app.get("/v1/visitor/evacuation/roster", async (req: FastifyRequest, reply: FastifyReply) => {
    // Break-glass but NOT anonymous: the roster is decrypted-PII. Require a valid
    // JWT (authPlugin already 401s a missing/invalid token) carrying an emergency
    // role, THEN the fail-closed IP allowlist.
    const ctx = resolveContext(req);
    requireRole(ctx, EMERGENCY_READ_ROLES);
    requireAllowedIp(req);
    const query = rosterQuery.parse(req.query);
    // Tenant comes from the AUTHENTICATED token, never the (spoofable) query
    // param, so a token for tenant A cannot pull tenant B's roster.
    const roster = await getFullRoster(ctx.tenantId, query.locationId);
    return reply.send({ data: roster });
  });

  /**
   * GET /v1/visitor/evacuation/count
   * Emergency access (IP-allowlist, no standard auth).
   * Returns headcount for a given location + tenant.
   */
  app.get("/v1/visitor/evacuation/count", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EMERGENCY_READ_ROLES);
    requireAllowedIp(req);
    const query = rosterQuery.parse(req.query);
    const count = await getVisitorCount(ctx.tenantId, query.locationId);
    return reply.send({ data: { count } });
  });

  /**
   * POST /v1/visitor/evacuation/declare
   * Standard auth — security admin/fire warden declares an evacuation.
   * Route → zod validate → publish command → 202 Accepted.
   */
  app.post("/v1/visitor/evacuation/declare", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = evacuationDeclareBody.parse(req.body);
    const accepted = await commands.evacuationDeclare(ctx, {
      locationId: body.locationId,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/evacuation/mark-safe
   * Standard auth — security/fire warden marks a visitor as safely evacuated.
   * Route → zod validate → publish command → 202 Accepted.
   */
  app.post("/v1/visitor/evacuation/mark-safe", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = evacuationMarkSafeBody.parse(req.body);
    const accepted = await commands.evacuationMarkSafe(ctx, {
      locationId: body.locationId,
      passId: body.passId,
    });
    return reply.code(202).send({ data: accepted });
  });
}
