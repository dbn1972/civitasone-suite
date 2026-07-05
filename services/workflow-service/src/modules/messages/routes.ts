/**
 * Message/Signal HTTP routes.
 *
 * - POST /v1/workflow/messages/deliver — deliver a correlated message
 * - POST /v1/workflow/signals/broadcast — broadcast a signal to all listeners
 * - GET /v1/workflow/instances/:instanceId/subscriptions — list subscriptions
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { deliverMessageBody, broadcastSignalBody, instanceIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = [
  "workflow_user", "workflow_admin", "super_admin",
  "estab_officer", "estab_admin",
];

const ADMIN_ROLES = ["workflow_admin", "super_admin"];

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/workflow/messages/deliver
   * Deliver a correlated message to a waiting workflow instance.
   */
  app.post("/v1/workflow/messages/deliver", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = deliverMessageBody.parse(req.body ?? {});
    const result = await commands.deliverMessage(ctx, body.messageName, body.correlationKey, body.payload);
    return reply.code(202).send(result);
  });

  /**
   * POST /v1/workflow/signals/broadcast
   * Broadcast a signal to all active signal subscriptions in the tenant.
   */
  app.post("/v1/workflow/signals/broadcast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = broadcastSignalBody.parse(req.body ?? {});
    const result = await commands.broadcastSignal(ctx, body.signalName, body.payload);
    return reply.code(202).send(result);
  });

  /**
   * GET /v1/workflow/instances/:instanceId/subscriptions
   * List all message and signal subscriptions for a workflow instance.
   */
  app.get("/v1/workflow/instances/:instanceId/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { instanceId } = instanceIdParam.parse(req.params);
    const subs = await queries.listSubscriptionsForInstance(instanceId);
    return reply.send({ data: subs });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")) {
      const zodErr = err as unknown as ZodError;
      const issues = zodErr.issues ?? [];
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: issues.map((i: { path: (string | number)[]; message: string }) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
