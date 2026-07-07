import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDealBody, updateDealStageBody, updateDealBody, idParam, dealsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const RESOURCE = "deal";
const AUDIT_TOPIC = "audit.event.record";

export async function dealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/deals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createDealBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDeal(ctx, body));
  });

  app.get("/v1/crm/deals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, dealsListSchema, await queries.listDeals(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/crm/deals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const deal = await queries.getDeal(id, ctx.tenantId);
    if (!deal) throw new HttpError(404, "NOT_FOUND", "deal not found");
    return reply.send(deal);
  });

  /**
   * Stage transition with optimistic locking.
   * Synchronous to provide immediate 409 feedback for kanban drag-and-drop.
   * Emits audit event with previous and new stage on success.
   */
  app.patch("/v1/crm/deals/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDealStageBody.parse(req.body);

    const result = await db.transaction(async (tx) => {
      const res = await repo.updateStageWithVersion(
        tx, id, ctx.tenantId, body.stage, body.stageId, body.version, ctx.actorId, body.probability,
      );
      if (!res.updated) return res;

      // Emit audit event with prev/new stage transition
      await enqueue(tx, {
        topic: EVENTS.dealStageUpdated,
        eventType: EVENTS.dealStageUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          dealId: id,
          previousStage: res.previousStage,
          newStage: body.stage,
          transitionTimestamp: new Date().toISOString(),
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "crm",
          action: "update_stage",
          resourceType: "deal",
          resourceId: id,
          outcome: "success",
          previousStage: res.previousStage,
          newStage: body.stage,
        },
      });
      return res;
    });

    if (!result.updated) {
      throw new HttpError(409, "VERSION_CONFLICT", "deal version conflict — refresh and retry");
    }

    // Invalidate cache after successful transition
    await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
    await cache.invalidateResource(ctx.tenantId, RESOURCE);

    return reply.code(200).send({
      data: { id, stage: body.stage, previousStage: result.previousStage },
    });
  });

  app.patch("/v1/crm/deals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDealBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDeal(ctx, id, body));
  });

  app.delete("/v1/crm/deals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteDeal(ctx, id));
  });
}
