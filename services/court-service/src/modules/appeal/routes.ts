import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  appealIdParam,
  caseIdParam,
  fileAppealBody,
  registerAppealBody,
  decideAppealBody,
  withdrawAppealBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const APPEAL_WRITE_ROLES = ["registrar", "court_admin", "judge", "super_admin"];
const APPEAL_READ_ROLES = ["registrar", "court_admin", "judge", "court_clerk", "super_admin"];

export async function appealRoutes(app: FastifyInstance): Promise<void> {
  // File an appeal against an original case's order (write path → command bus, 202).
  app.post("/v1/court/appeals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPEAL_WRITE_ROLES);
    const body = fileAppealBody.parse(req.body);
    const result = await commands.fileAppeal(ctx, body);
    return reply.code(202).send(result);
  });

  // List the appeals filed against a case.
  app.get("/v1/court/cases/:id/appeals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPEAL_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listAppealsByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Fetch a single appeal.
  app.get("/v1/court/appeals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPEAL_READ_ROLES);
    const { id } = appealIdParam.parse(req.params);
    const appeal = await repo.getAppeal(ctx.tenantId, id);
    if (!appeal) throw new HttpError(404, "APPEAL_NOT_FOUND", `appeal ${id} not found`);
    return reply.send(appeal);
  });

  // Register a filed appeal.
  app.patch("/v1/court/appeals/:id/register", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPEAL_WRITE_ROLES);
    const { id } = appealIdParam.parse(req.params);
    const body = registerAppealBody.parse(req.body);
    const result = await commands.registerAppeal(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Decide a registered appeal.
  app.patch("/v1/court/appeals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPEAL_WRITE_ROLES);
    const { id } = appealIdParam.parse(req.params);
    const body = decideAppealBody.parse(req.body);
    const result = await commands.decideAppeal(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Withdraw an appeal.
  app.patch("/v1/court/appeals/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPEAL_WRITE_ROLES);
    const { id } = appealIdParam.parse(req.params);
    const body = withdrawAppealBody.parse(req.body);
    const result = await commands.withdrawAppeal(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "appeal route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
