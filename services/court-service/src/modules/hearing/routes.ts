import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, hearingIdParam, scheduleHearingBody, adjournHearingBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const HEARING_WRITE_ROLES = ["registrar", "court_admin", "judge", "super_admin"];
const HEARING_READ_ROLES = ["registrar", "court_admin", "judge", "court_clerk", "super_admin"];

export async function hearingRoutes(app: FastifyInstance): Promise<void> {
  // Schedule a hearing on a case.
  app.post("/v1/court/cases/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = scheduleHearingBody.parse(req.body);
    const result = await commands.scheduleHearing(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's hearings.
  app.get("/v1/court/cases/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listHearingsByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Adjourn a hearing.
  app.patch("/v1/court/hearings/:id/adjourn", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_WRITE_ROLES);
    const { id } = hearingIdParam.parse(req.params);
    const body = adjournHearingBody.parse(req.body);
    const result = await commands.adjournHearing(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "hearing route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
