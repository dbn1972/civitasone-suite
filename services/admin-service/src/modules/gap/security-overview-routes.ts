/**
 * GET /v1/admin/security/overview — the Security Center aggregate, computed from real sources:
 *   activeSessions / trustedDevices / mfaAdoptionRate : identity-service  GET /identity/security/summary
 *   failedLogins24h : audit-service count of identity events with outcome "failure" in the last 24 h
 *                     (identity audits every failed MFA verification; the primary password check is
 *                     Keycloak's and is not visible to the platform)
 *   events          : the 20 most recent identity-service audit events (MFA, sessions, RBAC, API keys,
 *                     break-glass, SCIM...)
 *
 * The caller's own bearer token is forwarded (see upstream-client.ts), so each peer re-applies its own
 * authorization. The audit trail is deliberately restricted to audit-log readers, and identity's summary
 * to session admins, so the route is gated to the INTERSECTION of the two role sets: a role that either
 * peer would refuse is refused here up front rather than answered with a half-empty dashboard.
 */
import type { FastifyInstance } from "fastify";
import { AdminSecurityOverviewSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { callUpstream, relayError, identityBaseUrl, auditBaseUrl } from "./upstream-client.js";

/** identity SESSION_ADMIN ∩ audit EVENT_READ_ROLES. */
export const SECURITY_OVERVIEW_ROLES = ["platform_admin", "super_admin"];
const RECENT_EVENTS = 20;
const RATE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } } as const;

interface AuditEventRaw {
  id?: unknown; type?: unknown; occurredAt?: unknown; ipAddress?: unknown;
  actor?: unknown; payload?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Map one audit-service event to the SecurityEvent the Security Center table renders. */
export function toSecurityEvent(e: AuditEventRaw) {
  const payload = (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
  const actor = (e.actor && typeof e.actor === "object" ? e.actor : {}) as Record<string, unknown>;
  return {
    id: String(e.id ?? ""),
    timestamp: str(e.occurredAt) ?? "",
    type: str(payload.action) ?? str(e.type) ?? "event",
    actor: str(actor.email) ?? str(actor.name) ?? str(actor.actorId) ?? "system",
    ipAddress: str(e.ipAddress) ?? "—",
    outcome: str(payload.outcome) ?? "success",
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export async function securityOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/security/overview", RATE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECURITY_OVERVIEW_ROLES);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [summary, failed, recent] = await Promise.all([
      callUpstream<Record<string, unknown>>(req, ctx, "GET", identityBaseUrl(), "/identity/security/summary"),
      callUpstream<{ total?: unknown }>(
        req, ctx, "GET", auditBaseUrl(),
        `/audit/events/count?service=identity&outcome=failure&from=${encodeURIComponent(since)}`,
      ),
      callUpstream<AuditEventRaw[]>(req, ctx, "GET", auditBaseUrl(), `/audit/events?service=identity&limit=${RECENT_EVENTS}`),
    ]);
    for (const r of [summary, failed, recent]) {
      if (r.status < 200 || r.status >= 300) {
        const e = relayError(r.status, r.body);
        return reply.code(e.status).send(e.payload);
      }
    }
    if (!summary.body || typeof summary.body !== "object" || !Array.isArray(recent.body)) {
      throw new HttpError(502, "UPSTREAM_BAD_SHAPE", "a security data source answered with an unexpected shape");
    }
    sendValidated(reply, AdminSecurityOverviewSchema, {
      activeSessions: num(summary.body.activeSessions),
      failedLogins24h: num(failed.body?.total),
      mfaAdoptionRate: Math.min(100, num(summary.body.mfaAdoptionRate)),
      trustedDevices: num(summary.body.trustedDevices),
      events: recent.body.map(toSecurityEvent),
    });
    return reply;
  });
}
