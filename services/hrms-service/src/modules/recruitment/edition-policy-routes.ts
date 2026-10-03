import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { EDITIONS } from "./edition-policy.js";
import * as repo from "./edition-policy-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];

const setPolicyBody = z.object({
  edition: z.enum(EDITIONS),
  // null / omitted = follow the edition default.
  requireRequisition: z.boolean().nullable().optional(),
});

/**
 * GAP-RECRUITMENT-NEW-06: read / set the tenant's recruitment edition policy.
 *   GET /v1/hrms/recruitment-policy   -> { edition, requireRequisition, requisitionRequired }
 *   PUT /v1/hrms/recruitment-policy   (admin) -> 202; the write happens in the consumer, with an audit event
 */
export async function editionPolicyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/recruitment-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    // The new-vacancy form reads this for every vacancy author, not only HR staff.
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const p = await repo.resolvePolicy(ctx.tenantId);
    return reply.send({ edition: p.edition, requireRequisition: p.requireRequisition, requisitionRequired: p.requisitionRequired, source: p.source, tenantEdition: p.tenantEdition });
  });

  app.put("/v1/hrms/recruitment-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = setPolicyBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.recruitmentPolicySet, {
      messageId: id, type: COMMANDS.recruitmentPolicySet,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, edition: body.edition, requireRequisition: body.requireRequisition ?? null },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
