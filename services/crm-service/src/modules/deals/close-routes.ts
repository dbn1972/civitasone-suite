/**
 * Deal close routes (OP-006).
 * POST /v1/crm/deals/:id/close — close as won | lost | cancelled | on_hold with a
 *   mandatory reason (for non-won outcomes) and, when the tenant policy requires it,
 *   a competitor on a loss. Closure is refused synchronously (422) when the deal is
 *   already closed so the caller gets a real answer, not a 202.
 *
 *   A close-as-WON is a stage transition into "Won" like any other, so it is subject
 *   to the SAME sequence gate and mandatory-fields gate a PATCH /stage move would be
 *   (422 GATED_STAGE_SKIPPED / MANDATORY_STAGE_FIELDS_MISSING) — you cannot close-won
 *   a deal that never walked through its pipeline's gated stages by going through this
 *   route instead of /stage. lost/cancelled/on_hold are deliberately NOT gated: losing
 *   or parking a deal is legitimate from any stage and must not require satisfying a
 *   later stage's mandatory fields first.
 * PUT /v1/crm/deals/close-policy — set the per-tenant close policy (competitor-on-loss).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as pipelineRepo from "../pipelines/repo.js";
import { missingMandatoryFields, findStage, skippedGateStage } from "./stage-gate.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const idParam = z.object({ id: z.string().uuid() });

const CLOSE_OUTCOMES = ["won", "lost", "cancelled", "on_hold"] as const;
const REASON_MIN = 10;

const closeDealBody = z.object({
  outcome: z.enum(CLOSE_OUTCOMES),
  reason: z.string().max(1000).default(""),
  closedValue: z.string().regex(/^\d+$/).optional(),
  competitor: z.array(z.string().min(1).max(160)).max(50).optional(),
});

const closePolicyBody = z.object({
  competitorRequiredOnLoss: z.boolean(),
});

export async function closeRoutes(app: FastifyInstance): Promise<void> {
  app.put("/v1/crm/deals/close-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = closePolicyBody.parse(req.body);
    const msgId = commandId(ctx, COMMANDS.setDealClosePolicy);
    await queue.publish(COMMANDS.setDealClosePolicy, {
      messageId: msgId,
      type: COMMANDS.setDealClosePolicy,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, competitorRequiredOnLoss: body.competitorRequiredOnLoss },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/crm/deals/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeDealBody.parse(req.body);

    // A reason is mandatory for every outcome except a win (a won deal has no loss/park
    // reason to record); losses/cancellations/holds must say why.
    if (body.outcome !== "won") {
      if (body.reason.trim().length < REASON_MIN) {
        throw new HttpError(400, "REASON_REQUIRED", `a reason of at least ${REASON_MIN} characters is required to close as ${body.outcome}`);
      }
    }

    const rows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT d.id, d.status, d.stage, d.close_outcome AS "closeOutcome",
               COALESCE(p.competitor_required_on_loss, false) AS "competitorRequired"
        FROM crm.deals d
        LEFT JOIN crm.deal_close_policy p ON p.tenant_id = d.tenant_id
        WHERE d.id = ${id} AND d.tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; status: string; stage: string; closeOutcome: string | null; competitorRequired: boolean }>;
    });
    const deal = rows[0];
    if (!deal) throw new HttpError(404, "NOT_FOUND", "deal not found");

    if (deal.stage === "Won" || deal.stage === "Lost" || deal.closeOutcome !== null) {
      throw new HttpError(422, "ALREADY_CLOSED", "deal is already closed");
    }

    // Close-as-won is a stage transition into "Won" — enforce the same gates a
    // PATCH /stage move into Won would (see PATCH /v1/crm/deals/:id/stage for the
    // identical block). lost/cancelled/on_hold intentionally skip this: those are not
    // "entering a later stage" and must remain reachable from anywhere.
    if (body.outcome === "won") {
      const snap = await repo.gateSnapshot(id, ctx.tenantId);
      if (snap && snap.pipelineId) {
        const stages = await pipelineRepo.stagesOf(snap.pipelineId, ctx.tenantId);
        const target = findStage(stages, { stageName: "Won" });
        if (target) {
          const missing = missingMandatoryFields(snap, target);
          if (missing.length > 0) {
            throw new HttpError(
              422,
              "MANDATORY_STAGE_FIELDS_MISSING",
              `stage '${target.name}' requires: ${missing.join(", ")}`,
            );
          }
          const current = findStage(stages, { stageName: snap.stage });
          const skipped = skippedGateStage(stages, current, target);
          if (skipped) {
            throw new HttpError(
              422,
              "GATED_STAGE_SKIPPED",
              `stage '${target.name}' cannot be reached by skipping gated stage '${skipped.name}'`,
            );
          }
        }
      }
    }

    // Competitor capture on a loss is a per-tenant policy (default off).
    if (body.outcome === "lost" && deal.competitorRequired) {
      if (!body.competitor || body.competitor.length === 0) {
        throw new HttpError(422, "COMPETITOR_REQUIRED", "at least one competitor is required to close as lost");
      }
    }

    const msgId = commandId(ctx, `${COMMANDS.closeDeal}:${id}`);
    await queue.publish(COMMANDS.closeDeal, {
      messageId: msgId,
      type: COMMANDS.closeDeal,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        dealId: id,
        outcome: body.outcome,
        reason: body.reason,
        closedValue: body.closedValue ?? null,
        competitor: body.competitor ?? null,
      },
    });

    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });
}
