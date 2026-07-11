import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, directionIdParam, createDirectionBody, updateComplianceBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const COMPLIANCE_WRITE_ROLES = ["registrar", "court_admin", "judge", "super_admin"];
const COMPLIANCE_READ_ROLES = ["registrar", "court_admin", "judge", "court_clerk", "super_admin"];

export async function complianceRoutes(app: FastifyInstance): Promise<void> {
  // Create a compliance direction on a case.
  app.post("/v1/court/cases/:id/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMPLIANCE_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = createDirectionBody.parse(req.body);
    const result = await commands.createDirection(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's compliance directions.
  app.get("/v1/court/cases/:id/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMPLIANCE_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Record progress / close a compliance direction.
  app.patch("/v1/court/compliance/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMPLIANCE_WRITE_ROLES);
    const { id } = directionIdParam.parse(req.params);
    const body = updateComplianceBody.parse(req.body);
    const result = await commands.updateCompliance(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "compliance route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
