/**
 * F.5 — AI pause/resume protocol (human handoff).
 *
 * POST /v1/notification/inbox/:conversationId/handoff  — apply a transition (202)
 * GET  /v1/notification/inbox/:conversationId/handoff  — current state + audit trail
 *
 * The transition is validated at the boundary against the conversation's current
 * state so an illegal action gets a synchronous 422 instead of a dead-lettered
 * command. The consumer re-validates, so a concurrent transition still cannot
 * slip through.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  applyHandoffTransition,
  allowedActions,
  isAiPaused,
  HANDOFF_ACTIONS,
} from "./handoff-domain.js";
import * as commands from "./keyword-commands.js";
import * as repo from "./keyword-repo.js";

const WRITE_ROLES = [
  "notification_admin", "super_admin", "tenant_admin", "platform_admin",
  "helpdesk_admin", "helpdesk_user", "crm_admin",
];
const READ_ROLES = [...WRITE_ROLES, "audit_officer"];

const conversationIdParam = z.object({ conversationId: z.string().uuid() });

const handoffBody = z.object({
  action: z.enum(HANDOFF_ACTIONS),
  agentId: z.string().uuid().optional(),
  reason: z.string().min(1).max(2000).optional(),
});

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function handoffRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/inbox/:conversationId/handoff", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);
    const body = handoffBody.parse(req.body);

    const current = await repo.currentHandoffState(ctx.tenantId, conversationId);
    const result = applyHandoffTransition(current.state, {
      action: body.action,
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
    });
    if (!result.ok) {
      // 422 not 400: the request is well-formed, the business rule refuses it.
      throw new HttpError(422, result.code, result.message);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.transitionHandoff(ctx, {
      conversationId,
      action: body.action,
      expectedFromState: current.state,
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    }));
  });

  app.get("/v1/notification/inbox/:conversationId/handoff", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);
    const q = auditQuery.parse(req.query);

    const current = await repo.currentHandoffState(ctx.tenantId, conversationId);
    const trail = await repo.listHandoffAudit(ctx.tenantId, conversationId, q.limit);
    return reply.send({
      data: {
        conversationId,
        state: current.state,
        assignedAgentId: current.assignedAgentId,
        aiPaused: isAiPaused(current.state),
        allowedActions: allowedActions(current.state),
        /** false when the conversation has never been handed off. */
        everHandedOff: current.exists,
        auditTrail: trail.map((a) => ({
          id: a.id,
          fromState: a.fromState,
          toState: a.toState,
          action: a.action,
          agentId: a.agentId,
          reason: a.reason,
          occurredAt: a.occurredAt.toISOString(),
        })),
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
