/**
 * G22 — Context-attach rule engine HTTP routes.
 *
 * - GET  /v1/crm/context-attach-rules       — list rules (crm_user+)
 * - POST /v1/crm/context-attach-rules       — create rule (crm_admin) → 202
 * - PATCH /v1/crm/context-attach-rules/:id  — update rule (crm_admin) → 202
 * - DELETE /v1/crm/context-attach-rules/:id — delete rule (crm_admin) → 202
 * - GET  /v1/crm/context-attachments        — list attachments for an entity (crm_user+)
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishCreateRule, publishUpdateRule, publishDeleteRule } from "./commands.js";
import { listRules, listAttachments } from "./repo.js";
import {
  createRuleBody,
  updateRuleBody,
  listRulesQuery,
  listAttachmentsQuery,
  idParam,
} from "./validators.js";

const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const READ_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

export async function contextAttachRoutes(app: FastifyInstance): Promise<void> {
  // ── Rules ──

  app.get("/v1/crm/context-attach-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listRulesQuery.parse(req.query);
    const result = await listRules({
      tenantId: ctx.tenantId,
      limit: q.limit,
      offset: q.offset,
      ...(q.eventType !== undefined && { eventType: q.eventType }),
      ...(q.active !== undefined && { active: q.active }),
    });
    return reply.send({
      data: result.data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: result.total },
    });
  });

  app.post("/v1/crm/context-attach-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);
    publishCreateRule(ctx, body);
    return reply.code(202).send({ accepted: true });
  });

  app.patch("/v1/crm/context-attach-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);
    const changed = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    if (Object.keys(changed).length === 0) {
      throw new HttpError(400, "EMPTY_PATCH", "no fields to update");
    }
    publishUpdateRule(ctx, { id, changed, version: (req.body as Record<string, unknown>).version as number ?? 1 });
    return reply.code(202).send({ accepted: true });
  });

  app.delete("/v1/crm/context-attach-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    publishDeleteRule(ctx, { id });
    return reply.code(202).send({ accepted: true });
  });

  // ── Attachments ──

  app.get("/v1/crm/context-attachments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listAttachmentsQuery.parse(req.query);
    const result = await listAttachments({
      tenantId: ctx.tenantId,
      limit: q.limit,
      offset: q.offset,
      targetType: q.targetType,
      targetId: q.targetId,
    });
    return reply.send({
      data: result.data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: result.total },
    });
  });
}
