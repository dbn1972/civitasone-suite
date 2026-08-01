/**
 * Deal close routes (OP-006).
 * POST /v1/crm/deals/:id/close — close deal as won/lost with mandatory reason
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { sql } from "drizzle-orm";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

const closeDealBody = z.object({
  outcome: z.enum(["won", "lost"]),
  reason: z.string().max(1000).default(""),
  closedValue: z.string().regex(/^\d+$/).optional(),
});

export async function closeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/deals/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeDealBody.parse(req.body);

    // Validate: if outcome is 'lost', reason must be at least 10 chars
    if (body.outcome === "lost") {
      const trimmedReason = body.reason.trim();
      if (trimmedReason.length < 10) {
        throw new HttpError(400, "REASON_REQUIRED", "a reason of at least 10 characters is required when closing as lost");
      }
    }

    // Verify deal exists
    const deals = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, status, stage FROM crm.deals
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; status: string; stage: string }>;
    });

    const deal = deals[0];

    if (!deal) {
      throw new HttpError(404, "NOT_FOUND", "deal not found");
    }

    if (deal.stage === "Won" || deal.stage === "Lost") {
      throw new HttpError(422, "ALREADY_CLOSED", "deal is already closed");
    }

    const msgId = randomUUID();
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
      },
    });

    return reply.code(202).send({
      id: msgId,
      status: "accepted",
      correlationId: ctx.correlationId,
    });
  });
}
