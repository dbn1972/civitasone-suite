/**
 * GAP-ADMIN-API-MONITORING-06: the metrics endpoint behind /admin/api-monitoring.
 * A caller reads only its own tenant's traffic; a platform super-admin may also
 * pass tenantId=<uuid> or scope=all. The retention setting is changed through a
 * published command, never a direct write.
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { hasAnyRole } from "@civitasone/auth";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  DEFAULT_WINDOW_MINUTES, MAX_RETENTION_DAYS, MAX_WINDOW_MINUTES, MIN_RETENTION_DAYS,
  toApiRow,
} from "./domain.js";

const PLATFORM_ROLES = ["super_admin", "platform_admin"];

const readQuery = z.object({
  windowMinutes: z.coerce.number().int().min(1).max(MAX_WINDOW_MINUTES).default(DEFAULT_WINDOW_MINUTES),
  scope: z.enum(["tenant", "all"]).default("tenant"),
  tenantId: z.string().uuid().optional(),
});
const retentionBody = z.object({
  retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
});

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, "VALIDATION_FAILED", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export async function apiMonitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/api-monitoring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const q = parse(readQuery, req.query);
    const platform = hasAnyRole(ctx, PLATFORM_ROLES);
    const crossTenant = q.scope === "all" || (q.tenantId !== undefined && q.tenantId !== ctx.tenantId);
    if (crossTenant && !platform) {
      throw new HttpError(403, "FORBIDDEN", "only a platform super-admin can read another tenant's API metrics");
    }
    const now = new Date();
    const since = new Date(now.getTime() - q.windowMinutes * 60_000);
    const read = crossTenant
      ? await repo.readPlatformRollup(since, q.scope === "all" ? undefined : q.tenantId)
      : await repo.readOwnRollup(ctx.tenantId, since);
    const retentionDays = await repo.getRetentionDays(ctx.tenantId);
    return reply.send({
      data: read.rollups.map((r) => toApiRow(r, q.windowMinutes)),
      generatedAt: now.toISOString(),
      meta: {
        windowMinutes: q.windowMinutes,
        scope: crossTenant ? (q.scope === "all" ? "all" : "tenant") : "tenant",
        tenantId: crossTenant && q.scope === "all" ? null : (q.tenantId ?? ctx.tenantId),
        retentionDays,
        truncated: read.truncated,
        maxEndpoints: repo.MAX_ENDPOINTS,
      },
    });
  });

  app.get("/v1/admin/api-monitoring/retention", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    return reply.send({ data: { retentionDays: await repo.getRetentionDays(ctx.tenantId) } });
  });

  app.put("/v1/admin/api-monitoring/retention", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const body = parse(retentionBody, req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setRetention(ctx, body.retentionDays));
  });
}
