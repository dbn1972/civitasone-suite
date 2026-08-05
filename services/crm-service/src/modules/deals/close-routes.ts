/**
 * Deal close routes (OP-006).
 * POST /v1/crm/deals/:id/close — close as won | lost | cancelled | on_hold with a
 *   mandatory reason (for non-won outcomes) and, when the tenant policy requires it,
 *   a competitor on a loss. Closure is refused synchronously (422) when the deal is
 *   already closed so the caller gets a real answer, not a 202.
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
