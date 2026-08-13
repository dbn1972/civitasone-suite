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

export async function waterMeteringRoutes(app: FastifyInstance): Promise<void> {
  // ── meter readings ─────────────────────────────────────────────────────
  app.post("/v1/assets/water/readings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      connectionId: z.string().uuid(), readingDate: z.string(),
      previousReading: z.string(), currentReading: z.string(),
      photo: z.string().optional(),
    }).parse(req.body);
    const result = await commands.recordReading(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/water/readings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listReadings(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  // ── bills ──────────────────────────────────────────────────────────────
  app.post("/v1/assets/water/bills/generate", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      connectionId: z.string().uuid(), readingId: z.string().uuid(),
      consumptionKl: z.number(), ratePerKl: z.number(), billingPeriod: z.string(),
      dueDate: z.string(),
    }).parse(req.body);
    const result = await commands.generateBill(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/water/bills", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listBills(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/water/bills/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findBillById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "bill not found");
    return reply.send({ data: row });
  });

  // ── service requests ───────────────────────────────────────────────────
  app.post("/v1/assets/water/service-requests", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      connectionId: z.string().uuid(),
      requestType: z.enum(["leak_repair","meter_replacement","pressure_issue","disconnection","reconnection"]),
      description: z.string().optional(),
    }).parse(req.body);
    const result = await commands.createServiceRequest(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/water/service-requests", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listServiceRequests(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.patch("/v1/assets/water/service-requests/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ resolution: z.string().min(1) }).parse(req.body);
    const result = await commands.resolveServiceRequest(ctx, id, body.resolution);
    return reply.code(202).send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
