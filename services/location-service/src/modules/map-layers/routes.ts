import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "location_admin", "gis_admin"];
const READER = ["super_admin", "location_admin", "gis_admin", "location_user", "project_admin"];
const SOURCE_TYPES = ["tile", "wms", "geojson"] as const;

// GAP-LOCATIONS-MAPS-03: a layer URL is fetched by every viewer's browser, so it
// must be https (no mixed content, no javascript:/data:/file: schemes).
const httpsUrl = z
  .string()
  .max(2048)
  .url()
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "Layer source URL must use https");

export async function mapLayerRoutes(app: FastifyInstance): Promise<void> {
  // SVC-112: map-layer configuration API consumed by the web map viewer.
  app.get("/v1/locations/map-layers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const data = await repo.list(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.post("/v1/locations/map-layers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      name: z.string().min(1).max(200),
      sourceType: z.enum(SOURCE_TYPES),
      url: httpsUrl,
      styleJson: z.record(z.unknown()).optional(),
      zIndex: z.number().int().min(0).max(10000).default(0),
      visible: z.boolean().default(true),
    }).parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.mapLayerCreate(ctx, body));
  });

  app.patch("/v1/locations/map-layers/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      sourceType: z.enum(SOURCE_TYPES).optional(),
      url: httpsUrl.optional(),
      styleJson: z.record(z.unknown()).nullable().optional(),
      zIndex: z.number().int().min(0).max(10000).optional(),
      visible: z.boolean().optional(),
    }).parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "map layer not found");
    sendAccepted(reply, acceptedResponseSchema, await commands.mapLayerUpdate(ctx, id, body));
  });

  app.delete("/v1/locations/map-layers/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // GAP-LOCATIONS-MAPS-01: the web delete dialog collects a reason; it travels as
    // a query parameter (a DELETE body is dropped by some proxies) into the audit row.
    const { reason } = z.object({ reason: z.string().trim().min(1).max(500).optional() }).parse(req.query);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "map layer not found");
    sendAccepted(reply, acceptedResponseSchema, await commands.mapLayerDelete(ctx, id, reason));
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
