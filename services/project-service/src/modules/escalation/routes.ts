/**
 * GAP-PROJECTS-ESCALATIONS-02: escalation action routes (acknowledge /
 * reassign / clear → 202). Enforced server-side (ESCALATION_ACTION_ROLES) and
 * audited in the consumer's transaction. The escalation list itself is served
 * by project/mock-elimination-routes.ts (GET /v1/projects/escalations), which
 * overlays this module's persisted action state onto the synthetic projection.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";

// Acting on an escalation (acknowledge/reassign/clear) is a supervisory
// control, not a read — restricted to the roles that own the escalation queue.
// The server is the authority (this route 403s everyone else); the web hides
// the controls from a non-authorised user as defence-in-depth.
const ESCALATION_ACTION_ROLES = ["project_manager", "super_admin"];

const projectIdParam = z.object({ id: z.string().uuid() });

// A snapshot of the projection's issue/severity may be sent so the first-ever
// action can seed a self-describing persisted record; both optional.
const snapshot = {
  severity: z.enum(["blocked", "overdue", "pending"]).optional(),
  issue:    z.string().max(500).optional(),
};

const acknowledgeBody = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
  ...snapshot,
});
const reassignBody = z.object({
  escalatedTo: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500).optional(),
  ...snapshot,
});
const clearBody = z.object({
  reason: z.string().trim().min(1).max(500),
  ...snapshot,
});

export async function escalationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/projects/:id/escalation/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESCALATION_ACTION_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const body = acknowledgeBody.parse(req.body ?? {});
    return reply.code(202).send(await commands.actOnEscalation(ctx, id, "acknowledge", body));
  });

  app.post("/v1/projects/:id/escalation/reassign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESCALATION_ACTION_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const body = reassignBody.parse(req.body ?? {});
    return reply.code(202).send(await commands.actOnEscalation(ctx, id, "reassign", body));
  });

  app.post("/v1/projects/:id/escalation/clear", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESCALATION_ACTION_ROLES);
    const { id } = projectIdParam.parse(req.params);
    // Clearing an escalation requires a reason (recorded on the audit event).
    const body = clearBody.parse(req.body ?? {});
    return reply.code(202).send(await commands.actOnEscalation(ctx, id, "clear", body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
