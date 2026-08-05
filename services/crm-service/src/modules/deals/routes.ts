import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDealBody, updateDealStageBody, updateDealBody, idParam, dealsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import * as pipelineRepo from "../pipelines/repo.js";
import { missingMandatoryFields, findStage } from "./stage-gate.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const pipelineScopeQuery = z.object({ pipelineId: z.string().uuid().optional() });

export async function dealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/deals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createDealBody.parse(req.body);

    // OP-003: the stage gate is not only for PATCH transitions — a deal must not be
    // CREATED directly into a gated stage with its mandatory fields unset. When the
    // requested stage is beyond the pipeline's entry (lowest-ordinal) stage, enforce the
    // target stage's mandatory fields against the create body, synchronously (422).
    if (body.pipelineId) {
      const stages = await pipelineRepo.stagesOf(body.pipelineId, ctx.tenantId);
      if (stages && stages.length > 0) {
        const entry = stages.reduce((min, s) => (s.ordinal < min.ordinal ? s : min), stages[0]!);
        const target = findStage(stages, { ...(body.stageId ? { stageId: body.stageId } : {}), stageName: body.stage });
        if (target && target.id !== entry.id && target.name !== entry.name) {
          const snap = {
            product: body.product ?? null,
            quantity: body.quantity ?? null,
            competitors: body.competitors ?? [],
            nextStep: body.nextStep ?? null,
            expectedCloseDate: body.expectedCloseDate ?? null,
            closeDate: body.closeDate ?? null,
            valueMinor: String(body.valueMinor ?? 0),
            contactId: body.contactId ?? null,
            ownerId: body.ownerId ?? null,
            name: body.name,
            currency: body.currency,
          };
          const missing = missingMandatoryFields(snap, target);
          if (missing.length > 0) {
            throw new HttpError(422, "MANDATORY_STAGE_FIELDS_MISSING", `stage '${target.name}' requires: ${missing.join(", ")}`);
          }
        }
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createDeal(ctx, body));
  });

  app.get("/v1/crm/deals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, dealsListSchema, await queries.listDeals(ctx.tenantId, q.limit, q.offset));
  });

  // OP-005: stage-ageing dashboard — opportunities exceeding their configured stage limit.
  app.get("/v1/crm/deals/stage-ageing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = pipelineScopeQuery.parse(req.query ?? {});
    const rows = await repo.stageAgeingExceeding(ctx.tenantId, q.pipelineId);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // OP-004: kanban board — deals grouped by stage.
  app.get("/v1/crm/deals/kanban", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = pipelineScopeQuery.parse(req.query ?? {});
    const cards = await repo.kanbanCards(ctx.tenantId, q.pipelineId);
    const columns = new Map<string, typeof cards>();
    for (const c of cards) {
      const bucket = columns.get(c.stage) ?? [];
      bucket.push(c);
      columns.set(c.stage, bucket);
    }
    const data = [...columns.entries()].map(([stage, items]) => ({ stage, cards: items }));
    return reply.send({ data });
  });

  // OP-004: funnel — count + value per stage.
  app.get("/v1/crm/deals/funnel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = pipelineScopeQuery.parse(req.query ?? {});
    const buckets = await repo.funnelBuckets(ctx.tenantId, q.pipelineId);
    return reply.send({ data: buckets });
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
   * Stage transition. OP-003: before accepting a progression we load the deal and the
   * target stage's mandatory-field config and refuse (422) if any required opportunity
   * field is unpopulated — enforcement is synchronous because a 202/consumer path could
   * not report the rejection. Optimistic-lock version conflicts are still resolved
   * asynchronously by the consumer.
   */
  app.patch("/v1/crm/deals/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDealStageBody.parse(req.body);

    // Load the deal to evaluate the gate. When it is missing we do NOT reject here — the
    // stage command is still accepted and the consumer records the version_conflict /
    // missing-row outcome asynchronously, preserving the fire-and-forget contract.
    const snap = await repo.gateSnapshot(id, ctx.tenantId);
    if (snap && snap.pipelineId) {
      const stages = await pipelineRepo.stagesOf(snap.pipelineId, ctx.tenantId);
      const target = findStage(stages, { stageId: body.stageId, stageName: body.stage });
      if (target) {
        const missing = missingMandatoryFields(snap, target);
        if (missing.length > 0) {
          throw new HttpError(
            422,
            "MANDATORY_STAGE_FIELDS_MISSING",
            `stage '${target.name}' requires: ${missing.join(", ")}`,
          );
        }
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDealStage(ctx, id, body));
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
