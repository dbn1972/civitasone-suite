import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { GEO_POINT_REGISTER } from "./consumer.js";

const READER = ["super_admin", "location_admin", "gis_admin", "location_user", "project_admin"];
const WRITER = ["super_admin", "location_admin", "gis_admin"];

const bboxSchema = z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional();

export async function mapMarkerRoutes(app: FastifyInstance): Promise<void> {
  // SVC-119: aggregated marker feed for the monitoring map.
  app.get("/v1/locations/map-markers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = z.object({
      domain: z.string().max(48).optional(),
      status: z.string().max(32).optional(),
      bbox: bboxSchema,
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    }).parse(req.query);
    let bbox: [number, number, number, number] | undefined;
    if (q.bbox) {
      const parts = q.bbox.split(",").map(Number) as [number, number, number, number];
      bbox = parts;
    }
    const markers = await repo.markers(ctx.tenantId, { domain: q.domain, status: q.status, bbox }, q.limit);
    return reply.send({ markers, meta: { total: markers.length } });
  });

  // SVC-119: HTTP register endpoint (mirrors the queue extension point).
  app.post("/v1/locations/geo-points", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, WRITER);
    const body = z.object({
      domain: z.string().min(1).max(48),
      refId: z.string().min(1).max(128),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      label: z.string().max(256).optional(),
      status: z.string().max(32).optional(),
    }).parse(req.body);
    await repo.upsertGeoPoint(ctx.tenantId, ctx.actorId, body);
    // Also publish the command so the persistence path is exercised identically
    // for out-of-service registrations; the upsert above gives an immediate 201.
    await queue.publish(GEO_POINT_REGISTER, {
      messageId: `${body.domain}:${body.refId}:${Date.now()}`, type: GEO_POINT_REGISTER,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: body,
    });
    return reply.code(201).send({ data: { domain: body.domain, refId: body.refId, status: "registered" } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
