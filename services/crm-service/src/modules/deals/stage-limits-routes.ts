/**
 * Stage-limit configuration routes (OP-005).
 * Admins set per-tenant (optionally per-pipeline) maximum days a deal may sit in a stage;
 * the stage-ageing dashboard (GET /v1/crm/deals/stage-ageing) flags anything over the limit.
 * Writes are async-CQRS (202 → consumer upserts crm.stage_limits). Reads are synchronous.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";

const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const READ_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const upsertBody = z.object({
  pipelineId: z.string().uuid().nullable().optional(),
  stage: z.string().min(1).max(60),
  maxDays: z.number().int().min(1).max(3650),
  enabled: z.boolean().default(true),
});
const idParam = z.object({ id: z.string().uuid() });

export async function stageLimitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/stage-limits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rows = await scopedRead(async (tx) => tx.execute(sql`
      SELECT id, pipeline_id AS "pipelineId", stage, max_days AS "maxDays", enabled, version
      FROM crm.stage_limits
      WHERE tenant_id = ${ctx.tenantId}
      ORDER BY stage
    `)) as unknown as unknown[];
    return reply.send({ data: rows });
  });

  app.put("/v1/crm/stage-limits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = upsertBody.parse(req.body);
    const scopeKey = `${body.pipelineId ?? "default"}:${body.stage}`;
    const msgId = commandId(ctx, `${COMMANDS.upsertStageLimit}:${scopeKey}`);
    await queue.publish(COMMANDS.upsertStageLimit, {
      messageId: msgId,
      type: COMMANDS.upsertStageLimit,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, pipelineId: body.pipelineId ?? null, stage: body.stage, maxDays: body.maxDays, enabled: body.enabled },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.delete("/v1/crm/stage-limits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const msgId = commandId(ctx, `${COMMANDS.deleteStageLimit}:${id}`);
    await queue.publish(COMMANDS.deleteStageLimit, {
      messageId: msgId,
      type: COMMANDS.deleteStageLimit,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });
}
