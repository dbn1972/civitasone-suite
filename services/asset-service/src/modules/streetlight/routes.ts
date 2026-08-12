import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["super_admin", "asset_admin", "streetlight_admin", "streetlight_operator"];

const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function streetlightRoutes(app: FastifyInstance): Promise<void> {
  // ── streetlights ───────────────────────────────────────────────────────
  app.post("/v1/assets/streetlights", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      poleId: z.string().min(1), location: z.record(z.unknown()).optional(),
      lampType: z.enum(["led","sodium","mercury","solar"]),
      wattage: z.number().int().positive(),
      installationDate: z.string().optional(), circuitId: z.string().optional(),
    }).parse(req.body);
    const result = await commands.createStreetlight(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/streetlights", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listStreetlights(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/streetlights/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findStreetlightById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "streetlight not found");
    return reply.send({ data: row });
  });

  app.patch("/v1/assets/streetlights/:id/status", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["operational","faulty","under_repair","decommissioned"]) }).parse(req.body);
    const result = await commands.updateStreetlightStatus(ctx, id, body.status);
    return reply.code(202).send({ data: result });
  });

  // ── faults ─────────────────────────────────────────────────────────────
  app.post("/v1/assets/streetlight-faults", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      streetlightId: z.string().uuid(),
      faultType: z.enum(["not_working","flickering","broken","dim","timing_issue"]),
      description: z.string().optional(), photo: z.string().optional(),
    }).parse(req.body);
    const result = await commands.reportFault(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/streetlight-faults", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listFaults(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.patch("/v1/assets/streetlight-faults/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ assignedTo: z.string().uuid() }).parse(req.body);
    const result = await commands.assignFault(ctx, id, body.assignedTo);
    return reply.code(202).send({ data: result });
  });

  app.patch("/v1/assets/streetlight-faults/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ resolution: z.string().min(1) }).parse(req.body);
    const result = await commands.resolveFault(ctx, id, body.resolution);
    return reply.code(202).send({ data: result });
  });

  // ── requests ───────────────────────────────────────────────────────────
  app.post("/v1/assets/streetlight-requests", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      requestType: z.enum(["new_light","relocation","additional"]),
      location: z.record(z.unknown()).optional(), justification: z.string().optional(),
    }).parse(req.body);
    const result = await commands.createRequest(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/streetlight-requests", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listRequests(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.post("/v1/assets/streetlight-requests/:id/survey", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ surveyReport: z.record(z.unknown()) }).parse(req.body);
    const result = await commands.surveyRequest(ctx, id, body.surveyReport);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/streetlight-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await commands.approveRequest(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
