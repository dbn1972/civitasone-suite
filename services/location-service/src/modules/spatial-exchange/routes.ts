import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { parseGeoJson, parseKml, MAX_BYTES } from "./parse.js";

const ADMIN = ["super_admin", "location_admin", "gis_admin"];
const READER = ["super_admin", "location_admin", "gis_admin", "location_user", "project_admin"];

const datasetRe = /^[A-Za-z0-9._-]{1,128}$/;

export async function spatialExchangeRoutes(app: FastifyInstance): Promise<void> {
  // SVC-117: IMPORT — parse an uploaded GeoJSON FeatureCollection or KML and
  // persist its features into the tenant-scoped feature store.
  app.post("/v1/locations/spatial-exchange/import", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      dataset: z.string().regex(datasetRe, "dataset must be 1-128 chars [A-Za-z0-9._-]"),
      format: z.enum(["geojson", "kml"]),
      data: z.union([z.string(), z.record(z.unknown())]),
    }).parse(req.body);

    const rawSize = typeof body.data === "string" ? Buffer.byteLength(body.data, "utf8") : Buffer.byteLength(JSON.stringify(body.data), "utf8");
    if (rawSize > MAX_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `input exceeds ${MAX_BYTES} bytes`);

    let features;
    if (body.format === "geojson") {
      const parsed = typeof body.data === "string" ? safeJson(body.data) : body.data;
      features = parseGeoJson(parsed);
    } else {
      if (typeof body.data !== "string") throw new HttpError(400, "INVALID_KML", "KML data must be a string");
      features = parseKml(body.data);
    }

    const stored = await repo.importFeatures(ctx.tenantId, ctx.actorId, body.dataset, body.format, features);
    return reply.code(201).send({ data: { dataset: body.dataset, imported: stored } });
  });

  // SVC-117: EXPORT — emit a dataset as GeoJSON (default) or KML.
  app.get("/v1/locations/spatial-exchange/export", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = z.object({
      dataset: z.string().regex(datasetRe),
      format: z.enum(["geojson", "kml"]).default("geojson"),
      limit: z.coerce.number().int().min(1).max(10000).default(5000),
    }).parse(req.query);

    const features = await repo.exportFeatures(ctx.tenantId, q.dataset, q.limit);
    if (q.format === "kml") {
      return reply.header("content-type", "application/vnd.google-earth.kml+xml").send(repo.toKml(q.dataset, features));
    }
    return reply.header("content-type", "application/geo+json").send(repo.toGeoJson(features));
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { throw new HttpError(400, "INVALID_GEOJSON", "data is not valid JSON"); }
}
