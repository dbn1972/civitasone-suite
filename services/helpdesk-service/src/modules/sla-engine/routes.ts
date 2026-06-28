/**
 * Helpdesk SLA Engine Module
 *
 * Endpoints:
 *  GET   /v1/helpdesk/sla/config    — SLA rules (response time, resolution time by priority)
 *  PATCH /v1/helpdesk/sla/config    — update SLA thresholds
 *  GET   /v1/helpdesk/sla/breaches  — list tickets breaching SLA
 *  GET   /v1/helpdesk/sla/metrics   — avg resolution time, % within SLA, breach count
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";

const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];
const READER_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];

const slaConfigUpdateBody = z.object({
  rules: z.array(z.object({
    priority: z.enum(["critical", "high", "medium", "low"]),
    responseTimeMinutes: z.coerce.number().int().min(1),
    resolutionTimeMinutes: z.coerce.number().int().min(1),
    escalateAfterMinutes: z.coerce.number().int().min(1).optional(),
  })).min(1),
});

export async function slaEngineRoutes(app: FastifyInstance): Promise<void> {
  // Get SLA configuration
  app.get("/v1/helpdesk/sla/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const rows = await sqlClient`
      SELECT priority, response_time_minutes, resolution_time_minutes,
             escalate_after_minutes, updated_at
      FROM helpdesk.sla_config
      WHERE tenant_id = ${ctx.tenantId}
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END
    `;

    // Return defaults if no config exists
    if (rows.length === 0) {
      return reply.send({
        data: {
          rules: [
            { priority: "critical", responseTimeMinutes: 30, resolutionTimeMinutes: 240, escalateAfterMinutes: 60 },
            { priority: "high", responseTimeMinutes: 60, resolutionTimeMinutes: 480, escalateAfterMinutes: 120 },
            { priority: "medium", responseTimeMinutes: 240, resolutionTimeMinutes: 1440, escalateAfterMinutes: 480 },
            { priority: "low", responseTimeMinutes: 480, resolutionTimeMinutes: 2880, escalateAfterMinutes: 1440 },
          ],
          source: "defaults",
        },
      });
    }

    return reply.send({ data: { rules: rows, source: "configured" } });
  });

  // Update SLA thresholds
  app.patch("/v1/helpdesk/sla/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = slaConfigUpdateBody.parse(req.body);

    for (const rule of body.rules) {
      await sqlClient`
        INSERT INTO helpdesk.sla_config (
          tenant_id, priority, response_time_minutes, resolution_time_minutes,
          escalate_after_minutes, updated_by, updated_at
        ) VALUES (
          ${ctx.tenantId}, ${rule.priority}, ${rule.responseTimeMinutes},
          ${rule.resolutionTimeMinutes}, ${rule.escalateAfterMinutes ?? null},
          ${ctx.actorId}, NOW()
        )
        ON CONFLICT (tenant_id, priority)
        DO UPDATE SET
          response_time_minutes = EXCLUDED.response_time_minutes,
          resolution_time_minutes = EXCLUDED.resolution_time_minutes,
          escalate_after_minutes = EXCLUDED.escalate_after_minutes,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      `;
    }

    return reply.send({ data: { updated: body.rules.length, message: "SLA config updated" } });
  });

  // List tickets breaching SLA
  app.get("/v1/helpdesk/sla/breaches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      priority: z.enum(["critical", "high", "medium", "low"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    // Default SLA thresholds in minutes if no config exists
    const rows = await sqlClient`
      WITH sla AS (
        SELECT priority, resolution_time_minutes
        FROM helpdesk.sla_config
        WHERE tenant_id = ${ctx.tenantId}
        UNION ALL
        SELECT p, m FROM (VALUES
          ('critical', 240), ('high', 480), ('medium', 1440), ('low', 2880)
        ) AS defaults(p, m)
        WHERE NOT EXISTS (
          SELECT 1 FROM helpdesk.sla_config WHERE tenant_id = ${ctx.tenantId}
        )
      )
      SELECT t.id, t.subject, t.priority, t.status, t.assigned_to,
             t.created_at,
             EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60 AS elapsed_minutes,
             s.resolution_time_minutes AS sla_minutes,
             EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60 - s.resolution_time_minutes AS breach_minutes
      FROM helpdesk.tickets t
      JOIN sla s ON LOWER(s.priority) = LOWER(t.priority)
      WHERE t.tenant_id = ${ctx.tenantId}
        AND t.status NOT IN ('closed', 'resolved')
        AND EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60 > s.resolution_time_minutes
        ${query.priority ? sqlClient`AND LOWER(t.priority) = LOWER(${query.priority})` : sqlClient``}
      ORDER BY breach_minutes DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;

    return reply.send({ data: rows });
  });

  // SLA metrics — avg resolution time, % within SLA, breach count
  app.get("/v1/helpdesk/sla/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.query);

    const [metrics] = await sqlClient`
      WITH resolved AS (
        SELECT
          t.id,
          t.priority,
          EXTRACT(EPOCH FROM (COALESCE(t.resolved_at, NOW()) - t.created_at)) / 60 AS resolution_minutes
        FROM helpdesk.tickets t
        WHERE t.tenant_id = ${ctx.tenantId}
          AND t.status IN ('closed', 'resolved')
          ${query.fromDate ? sqlClient`AND t.created_at >= ${query.fromDate}::date` : sqlClient``}
          ${query.toDate ? sqlClient`AND t.created_at <= ${query.toDate}::date + INTERVAL '1 day'` : sqlClient``}
      ),
      sla AS (
        SELECT priority, resolution_time_minutes
        FROM helpdesk.sla_config
        WHERE tenant_id = ${ctx.tenantId}
        UNION ALL
        SELECT p, m FROM (VALUES
          ('critical', 240), ('high', 480), ('medium', 1440), ('low', 2880)
        ) AS defaults(p, m)
        WHERE NOT EXISTS (
          SELECT 1 FROM helpdesk.sla_config WHERE tenant_id = ${ctx.tenantId}
        )
      )
      SELECT
        COUNT(r.id)::int AS total_resolved,
        ROUND(AVG(r.resolution_minutes)::numeric, 2) AS avg_resolution_minutes,
        COUNT(CASE WHEN r.resolution_minutes <= s.resolution_time_minutes THEN 1 END)::int AS within_sla,
        COUNT(CASE WHEN r.resolution_minutes > s.resolution_time_minutes THEN 1 END)::int AS breached,
        CASE
          WHEN COUNT(r.id) > 0
          THEN ROUND(COUNT(CASE WHEN r.resolution_minutes <= s.resolution_time_minutes THEN 1 END)::numeric * 100 / COUNT(r.id), 2)
          ELSE 0
        END AS sla_compliance_pct
      FROM resolved r
      LEFT JOIN sla s ON LOWER(s.priority) = LOWER(r.priority)
    `;

    // Current open breaches
    const [openBreaches] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM helpdesk.tickets t
      WHERE t.tenant_id = ${ctx.tenantId}
        AND t.status NOT IN ('closed', 'resolved')
        AND EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60 > COALESCE(
          (SELECT resolution_time_minutes FROM helpdesk.sla_config
           WHERE tenant_id = ${ctx.tenantId} AND LOWER(priority) = LOWER(t.priority)),
          CASE LOWER(t.priority)
            WHEN 'critical' THEN 240 WHEN 'high' THEN 480
            WHEN 'medium' THEN 1440 ELSE 2880
          END
        )
    `;

    return reply.send({
      data: {
        ...metrics,
        currentOpenBreaches: openBreaches?.count ?? 0,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
