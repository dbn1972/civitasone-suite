import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { evaluateDecision } from "./domain.js";

const AUDIT = "policy.decision";

const evaluateBody = z.object({
  permissionKey: z.string().min(3),
  actor: z.object({
    userId: z.string().uuid(),
    tenantId: z.string().uuid(),
    roles: z.array(z.string()).default([]),
  }).optional(),
  resource: z.record(z.unknown()).optional(),
});

export async function evaluateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/policy/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = evaluateBody.parse(req.body);

    // SAST-002 (CWE-863): NEVER trust a client-supplied actor. The evaluated
    // principal is derived from the authenticated context (ctx) by default.
    // A client-supplied body.actor (tenantId/roles) is honoured ONLY when the
    // caller proves it is a trusted internal service via the internal-trust
    // headers. The gateway strips `x-internal` / `x-service-secret` from
    // external clients, so end-user requests can never reach the internal path.
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    const isInternalCaller =
      req.headers["x-internal"] === "1" &&
      typeof internalSecret === "string" &&
      internalSecret.length > 0 &&
      req.headers["x-service-secret"] === internalSecret;

    const actor =
      isInternalCaller && body.actor
        ? body.actor
        : {
            userId: ctx.actorId,
            tenantId: ctx.tenantId,
            roles: ctx.roles,
          };

    // Resolve the granted permissions for the subject from the binding store
    // (scoped to actor.tenantId), never from client-asserted permissions.
    const granted = await repo.findGrantedPermissions(actor.tenantId, actor.userId, actor.roles);
    const result = evaluateDecision(body.permissionKey, actor.roles, granted);

    await db.transaction(async (tx) => {
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: actor.tenantId,
        actorId: actor.userId,
        correlationId: ctx.correlationId,
        payload: {
          permissionKey: body.permissionKey,
          decision: result.decision,
          reason: result.reason,
          resource: body.resource ?? null,
        },
      });
    });

    return reply.send(result);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
