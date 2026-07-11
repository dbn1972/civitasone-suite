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

/**
 * IP-allowlist middleware for emergency GET endpoints.
 *
 * Reads `EVACUATION_ALLOWED_IPS` from environment at startup (comma-separated
 * list of IPs or CIDRs — for simplicity, only exact IP matching is
 * implemented; CIDR range support can be added later if needed).
 *
 * When the env var is unset or empty, ALL IPs are allowed (dev/test
 * convenience — production deployments MUST set this variable).
 */
function parseAllowedIps(): Set<string> {
  const raw = process.env.EVACUATION_ALLOWED_IPS ?? "";
  if (!raw.trim()) return new Set(); // empty = allow all (dev mode)
  return new Set(raw.split(",").map((ip) => ip.trim()).filter(Boolean));
}

const allowedIps = parseAllowedIps();

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
  // If the allowlist is empty (env not set), skip check (dev/test mode).
  if (allowedIps.size === 0) return;
  const clientIp = getClientIp(req);
  if (!allowedIps.has(clientIp)) {
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
    requireAllowedIp(req);
    const query = rosterQuery.parse(req.query);
    const roster = await getFullRoster(query.tenantId, query.locationId);
    return reply.send({ data: roster });
  });

  /**
   * GET /v1/visitor/evacuation/count
   * Emergency access (IP-allowlist, no standard auth).
   * Returns headcount for a given location + tenant.
   */
  app.get("/v1/visitor/evacuation/count", async (req: FastifyRequest, reply: FastifyReply) => {
    requireAllowedIp(req);
    const query = rosterQuery.parse(req.query);
    const count = await getVisitorCount(query.tenantId, query.locationId);
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
