import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { GEO_POINT_REGISTER } from "./consumer.js";
import { COMMANDS } from "../../topics.js";

const READER = ["super_admin", "location_admin", "gis_admin", "location_user", "project_admin"];
const WRITER = ["super_admin", "location_admin", "gis_admin"];

const bboxSchema = z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional();

/**
 * GAP-LOCATIONS-MAPS-MONITORING-02: "as of" date, YYYY-MM-DD (IST calendar day). It answers "which records
 * existed on that day" (created on or before it). The service keeps no history of status or position
 * changes, so those are always today's values; meta.statusIsCurrent says so.
 */
const asOfSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "date is not a real calendar date")
  .optional();

export async function mapMarkerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/locations/map-markers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = z.object({
      domain: z.string().max(48).optional(),
      status: z.string().max(32).optional(),
      bbox: bboxSchema,
      date: asOfSchema,
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    }).parse(req.query);
    let bbox: [number, number, number, number] | undefined;
    if (q.bbox) {
      const parts = q.bbox.split(",").map(Number) as [number, number, number, number];
      bbox = parts;
    }
    // GAP-LOCATIONS-MAPS-MONITORING-02: ask for one extra row so a capped feed is
    // reported honestly (meta.truncated) instead of looking like the full set.
    // End of the requested IST day: a record created any time that day existed "as of" it.
    const createdBefore = q.date ? new Date(`${q.date}T23:59:59.999+05:30`) : undefined;
    const fetched = await repo.markers(ctx.tenantId, { domain: q.domain, status: q.status, bbox, createdBefore }, q.limit + 1);
    const truncated = fetched.length > q.limit;
    const markers = truncated ? fetched.slice(0, q.limit) : fetched;
    return reply.send({
      markers,
      meta: { total: markers.length, limit: q.limit, truncated, asOf: q.date ?? null, statusIsCurrent: true },
    });
  });

  // CQRS: publish only — consumer upserts (no sync repo write).
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
    const messageId = randomUUID();
    await queue.publish(GEO_POINT_REGISTER, {
      messageId, type: COMMANDS.geoPointRegister,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: body,
    });
    return reply.code(202).send({
      id: messageId,
      status: "accepted",
      correlationId: ctx.correlationId,
      data: { domain: body.domain, refId: body.refId, status: "queued" },
    });
  });

  // Shared envelope: ZodError->400, HttpError, malformed JSON->400 MALFORMED_BODY, Fastify 4xx passthrough (a local
  // copy missed JSON parse errors and answered 500).
  registerSchemaErrorHandler(app, HttpError);
}
