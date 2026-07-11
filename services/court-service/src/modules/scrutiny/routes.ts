import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, defectIdParam, recordScrutinyBody, raiseDefectBody, resolveDefectBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const SCRUTINY_WRITE_ROLES = ["registrar", "court_admin", "super_admin"];
const SCRUTINY_READ_ROLES = ["registrar", "court_admin", "super_admin", "court_clerk", "judge"];

export async function scrutinyRoutes(app: FastifyInstance): Promise<void> {
  // Record the registry scrutiny of a case.
  app.post("/v1/court/cases/:id/scrutiny", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCRUTINY_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = recordScrutinyBody.parse(req.body);
    const result = await commands.recordScrutiny(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Raise a defect against a case.
  app.post("/v1/court/cases/:id/defects", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCRUTINY_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = raiseDefectBody.parse(req.body);
    const result = await commands.raiseDefect(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's defects.
  app.get("/v1/court/cases/:id/defects", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCRUTINY_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listDefectsByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Resolve a defect.
  app.patch("/v1/court/defects/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCRUTINY_WRITE_ROLES);
    const { id } = defectIdParam.parse(req.params);
    const body = resolveDefectBody.parse(req.body);
    const result = await commands.resolveDefect(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "scrutiny route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
