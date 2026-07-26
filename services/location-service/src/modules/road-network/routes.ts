import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listQuerySchema } from "@civitasone/schemas/common";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "location_admin", "works_admin", "transport_admin"];
const READER = ["super_admin", "location_admin", "works_admin", "transport_admin", "location_user"];
const ROAD_CLASSES = ["national_highway", "state_highway", "major_district_road", "other_district_road", "village_road", "urban_road"] as const;

const coordPair = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export async function roadNetworkRoutes(app: FastifyInstance): Promise<void> {
  // SVC-115: create a road segment (PostGIS LineString, length derived).
  app.post("/v1/locations/road-network/segments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      name: z.string().min(1).max(200),
      roadClass: z.enum(ROAD_CLASSES),
      fromNode: z.string().min(1).max(64),
      toNode: z.string().min(1).max(64),
      coordinates: z.array(coordPair).min(2).max(5000),
    }).parse(req.body);
    const id = randomUUID();
    await repo.createSegment(ctx.tenantId, ctx.actorId, { id, ...body });
    return reply.code(201).send({ data: { id, status: "created" } });
  });

  app.get("/v1/locations/road-network/segments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listSegments(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.get("/v1/locations/road-network/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const seg = await repo.getSegment(id, ctx.tenantId);
    if (!seg) throw new HttpError(404, "NOT_FOUND", "segment not found");
    return reply.send({ data: seg });
  });

  app.get("/v1/locations/road-network/segments/:id/connected", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const seg = await repo.getSegment(id, ctx.tenantId);
    if (!seg) throw new HttpError(404, "NOT_FOUND", "segment not found");
    const data = await repo.connectedSegments(id, ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.delete("/v1/locations/road-network/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const n = await repo.deleteSegment(id, ctx.tenantId);
    if (n === 0) throw new HttpError(404, "NOT_FOUND", "segment not found");
    return reply.send({ data: { id, status: "deleted" } });
  });

  app.post("/v1/locations/road-network/networks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      segmentIds: z.array(z.string().uuid()).max(10000).default([]),
    }).parse(req.body);
    const id = randomUUID();
    await repo.createNetwork(ctx.tenantId, ctx.actorId, { id, ...body });
    return reply.code(201).send({ data: { id, status: "created" } });
  });

  app.get("/v1/locations/road-network/networks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listNetworks(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.get("/v1/locations/road-network/networks/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const net = await repo.getNetwork(id, ctx.tenantId);
    if (!net) throw new HttpError(404, "NOT_FOUND", "network not found");
    return reply.send({ data: net });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
