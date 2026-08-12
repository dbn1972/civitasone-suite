import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["super_admin", "asset_admin", "water_admin", "water_operator"];

const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function waterConnectionRoutes(app: FastifyInstance): Promise<void> {
  // ── applications ───────────────────────────────────────────────────────
  app.post("/v1/assets/water/applications", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      applicantName: z.string().min(1), applicantPhone: z.string().min(1),
      propertyId: z.string().optional(), connectionType: z.enum(["domestic","commercial","industrial","institutional"]),
      pipeSize: z.string().optional(), address: z.record(z.unknown()).optional(),
      documents: z.array(z.unknown()).optional(),
    }).parse(req.body);
    const result = await commands.createApplication(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/water/applications", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listApplications(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/water/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findApplicationById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/assets/water/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await commands.submitApplication(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/applications/:id/feasibility", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ report: z.record(z.unknown()) }).parse(req.body);
    const result = await commands.recordFeasibility(ctx, id, body.report);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/applications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await commands.approveApplication(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/applications/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    const result = await commands.rejectApplication(ctx, id, body.reason);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/applications/:id/install", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ meterId: z.string().optional(), pipeSize: z.string().optional() }).parse(req.body);
    const result = await commands.installConnection(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/applications/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await commands.activateConnection(ctx, id);
    return reply.code(202).send({ data: result });
  });

  // ── connections ────────────────────────────────────────────────────────
  app.get("/v1/assets/water/connections", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listConnections(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/water/connections/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findConnectionById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "connection not found");
    return reply.send({ data: row });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
