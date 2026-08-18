import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do"];
const READ_ROLES  = [...WRITE_ROLES, "works_viewer", "sdo", "section_officer", "estimator"];

export async function contractorRoutes(app: FastifyInstance): Promise<void> {
  // List contractors
  app.get("/v1/works/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = v.listQuerySchema.parse(req.query);
    const data = await repo.listContractors(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data, meta: { limit: q.limit, offset: q.offset } });
  });

  // Get contractor by id
  app.get("/v1/works/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const row = await repo.findContractorById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    return reply.send({ data: row });
  });

  // Get contractor rating history
  app.get("/v1/works/contractors/:id/rating-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const { limit } = v.listQuerySchema.parse(req.query);
    const rows = await repo.listRatingHistory(ctx.tenantId, id, Math.min(limit, 100));
    return reply.send({ data: rows });
  });

  // Create contractor
  app.post("/v1/works/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createContractorSchema.parse(req.body);
    const result = await commands.createContractor(ctx, body);
    return reply.status(202).send(result);
  });

  // Rate contractor (performance rating 1–5)
  app.patch("/v1/works/contractors/:id/rate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.rateContractorSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    const result = await commands.rateContractor(ctx, id, body.rating);
    return reply.status(202).send(result);
  });

  // Update contractor basic info
  app.patch("/v1/works/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.updateContractorSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    const patch = Object.fromEntries(
      Object.entries(body).filter(([, val]) => val !== undefined),
    ) as Parameters<typeof repo.updateContractor>[2];
    await repo.updateContractor(ctx.tenantId, id, patch, ctx.actorId);
    const updated = await repo.findContractorById(ctx.tenantId, id);
    return reply.send({ data: updated });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError)
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError)
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
