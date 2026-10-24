/**
 * GET /identity/security/summary — tenant-scoped authentication posture counts, read straight from
 * this service's own stores. Consumed by admin-service's GET /v1/admin/security/overview.
 *   activeSessions : sessions.sessions   status = 'active' and not yet expired
 *   trustedDevices : devices.registered_devices   not revoked / blocked
 *   mfaAdoptionRate: whole-number % of ACTIVE users with MFA enabled (0 when the tenant has no active users)
 */
import type { FastifyInstance } from "fastify";
import { and, eq, gt, notInArray, sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { sessions } from "../sessions/schema.js";
import { users } from "../users/schema.js";
import { registeredDevices } from "../devices/schema.js";

const SECURITY_ADMIN = ["platform_admin", "super_admin", "tenant_admin"];
const RATE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } } as const;

export function mfaAdoptionPercent(activeUsers: number, mfaUsers: number): number {
  if (activeUsers <= 0) return 0;
  return Math.min(100, Math.round((mfaUsers / activeUsers) * 100));
}

export async function securitySummaryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/identity/security/summary", RATE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECURITY_ADMIN);
    const [sess, dev, usr] = await scopedRead(async (tx) => [
      await tx.select({ n: sql<number>`count(*)::int` }).from(sessions)
        .where(and(eq(sessions.tenantId, ctx.tenantId), eq(sessions.status, "active"), gt(sessions.expiresAt, new Date()))),
      await tx.select({ n: sql<number>`count(*)::int` }).from(registeredDevices)
        .where(and(eq(registeredDevices.tenantId, ctx.tenantId), notInArray(registeredDevices.trustLevel, ["revoked", "blocked"]))),
      await tx.select({
        active: sql<number>`count(*)::int`,
        mfa: sql<number>`(count(*) filter (where ${users.mfaEnabled}))::int`,
      }).from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.status, "active"))),
    ] as const);
    return reply.send({
      activeSessions: Number(sess[0]?.n ?? 0),
      trustedDevices: Number(dev[0]?.n ?? 0),
      activeUsers: Number(usr[0]?.active ?? 0),
      mfaEnabledUsers: Number(usr[0]?.mfa ?? 0),
      mfaAdoptionRate: mfaAdoptionPercent(Number(usr[0]?.active ?? 0), Number(usr[0]?.mfa ?? 0)),
      asOf: new Date().toISOString(),
    });
  });
}
