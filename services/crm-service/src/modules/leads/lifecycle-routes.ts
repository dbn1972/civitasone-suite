/**
 * Lead Lifecycle Transition Route — POST /v1/crm/leads/:id/transition
 *
 * Validates status transitions against a state machine and enforces
 * mandatory reason codes for nurture/recycled/disqualified moves.
 * Supports LQ-004 requirement.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { contacts } from "../contacts/schema.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

/** Valid lead status transitions (from → allowed targets) */
const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["qualified", "nurture", "disqualified"],
  qualified: ["converted", "nurture", "recycled"],
  nurture: ["qualified", "disqualified"],
  recycled: ["qualified", "nurture"],
};

/** Statuses that require a mandatory reason (min 10 chars) */
const REASON_REQUIRED_STATUSES = ["nurture", "recycled", "disqualified"];

const leadIdParamSchema = z.object({
  id: z.string().uuid(),
});

const transitionBody = z.object({
  targetStatus: z.enum(["nurture", "recycled", "disqualified", "qualified", "converted"]),
  reason: z.string().default(""),
  notes: z.string().optional(),
});

export type TransitionBody = z.infer<typeof transitionBody>;

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/leads/:id/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const params = leadIdParamSchema.parse(req.params);
    const body = transitionBody.parse(req.body);

    // Enforce mandatory reason for specific target statuses
    if (REASON_REQUIRED_STATUSES.includes(body.targetStatus)) {
      if (!body.reason || body.reason.trim().length < 10) {
        throw new HttpError(
          400,
          "REASON_REQUIRED",
          `reason is required (min 10 chars) when transitioning to '${body.targetStatus}'`,
        );
      }
    }

    // Fetch current lead status — scopedRead wraps in db.transaction() which
    // sets the tenant GUC via AsyncLocalStorage so RLS is enforced.
    const rows = await scopedRead((tx) =>
      tx.select({ leadStatus: contacts.leadStatus })
        .from(contacts)
        .where(and(
          eq(contacts.id, params.id),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.status} = 'active'`,
        ))
        .limit(1),
    );

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "lead not found");
    }

    const currentStatus = rows[0]!.leadStatus;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed || !allowed.includes(body.targetStatus)) {
      throw new HttpError(
        422,
        "INVALID_TRANSITION",
        `cannot transition from '${currentStatus}' to '${body.targetStatus}'`,
      );
    }

    const messageId = randomUUID();

    await queue.publish(COMMANDS.leadTransition, {
      messageId,
      type: COMMANDS.leadTransition,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        contactId: params.id,
        fromStatus: currentStatus,
        targetStatus: body.targetStatus,
        reason: body.reason,
        notes: body.notes ?? null,
      },
    });

    return reply.code(202).send({
      id: messageId,
      status: "accepted",
      correlationId: ctx.correlationId,
    });
  });
}

export { VALID_TRANSITIONS, REASON_REQUIRED_STATUSES };
