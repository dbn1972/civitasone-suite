import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, updateCaseStatusBody } from "./validators.js";
import * as commands from "./commands.js";

/** Roles permitted to move a case through its lifecycle. */
const CASE_LIFECYCLE_ROLES = ["registrar", "court_admin", "judge", "super_admin"];

export async function caseLifecycleRoutes(app: FastifyInstance): Promise<void> {
  // Transition a case to a new status (write path → command bus, 202 Accepted).
  app.patch("/v1/court/cases/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CASE_LIFECYCLE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = updateCaseStatusBody.parse(req.body);
    const result = await commands.updateCaseStatus(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "case-lifecycle route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
