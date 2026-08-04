/**
 * Lead Lifecycle Transition Route — POST /v1/crm/leads/:id/transition
 *
 * Validates status transitions against a state machine and, for governed target
 * statuses, requires a reason CODE drawn from the per-tenant catalog
 * (crm.lead_reason_codes, LQ-004). Free-text `reason` is now an optional note.
 * Adds a re-open path (disqualified → new | qualified), which also requires a code.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { contacts } from "../contacts/schema.js";
import * as reasonCodes from "./reason-codes-repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

/** Valid lead status transitions (from → allowed targets). */
const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["qualified", "nurture", "disqualified"],
  qualified: ["converted", "nurture", "recycled"],
  nurture: ["qualified", "disqualified"],
  recycled: ["qualified", "nurture"],
  // LQ-004 re-open: a disqualified lead can be revived with a reason.
  disqualified: ["new", "qualified"],
};

/** Statuses whose transition requires a reason code by their own nature. */
const REASON_REQUIRED_STATUSES = ["nurture", "recycled", "disqualified"];

const leadIdParamSchema = z.object({ id: z.string().uuid() });

const transitionBody = z.object({
  targetStatus: z.enum(["nurture", "recycled", "disqualified", "qualified", "converted", "new"]),
  // A code from crm.lead_reason_codes valid for targetStatus; required for governed
  // transitions (see requiresReasonCode below).
  reasonCode: z.string().max(48).optional(),
  // Free-text note (optional); no longer the governance field.
  reason: z.string().max(2000).optional().default(""),
  notes: z.string().optional(),
});

export type TransitionBody = z.infer<typeof transitionBody>;

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/leads/:id/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const params = leadIdParamSchema.parse(req.params);
    const body = transitionBody.parse(req.body);

    // Fetch current lead status — scopedRead wraps in db.transaction() which sets the
    // tenant GUC via AsyncLocalStorage so RLS is enforced.
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

    // A reason code is required for the inherently-governed statuses AND for a
    // re-open (leaving 'disqualified'). Normal new → qualified stays code-free.
    const isReopen = currentStatus === "disqualified";
    const requiresReasonCode = REASON_REQUIRED_STATUSES.includes(body.targetStatus) || isReopen;

    if (requiresReasonCode) {
      if (!body.reasonCode || body.reasonCode.trim().length === 0) {
        throw new HttpError(
          400,
          "REASON_CODE_REQUIRED",
          `a reasonCode is required when transitioning to '${body.targetStatus}'`,
        );
      }
      const valid = await reasonCodes.isValidCode(ctx.tenantId, ctx.actorId, body.targetStatus, body.reasonCode);
      if (!valid) {
        throw new HttpError(
          422,
          "INVALID_REASON_CODE",
          `reasonCode '${body.reasonCode}' is not a valid active code for '${body.targetStatus}'`,
        );
      }
    }

    const messageId = commandId(ctx, `${COMMANDS.leadTransition}:${params.id}`);

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
        reasonCode: body.reasonCode ?? null,
        reason: body.reason,
        notes: body.notes ?? null,
        reopen: isReopen,
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
