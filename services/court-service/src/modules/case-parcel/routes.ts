import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, parcelIdParam, addParcelBody, updateParcelBody, searchQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import type { CaseParcelRow } from "./repo.js";

const PARCEL_WRITE_ROLES = ["registrar", "court_admin", "super_admin"];
const PARCEL_READ_ROLES = ["registrar", "court_admin", "super_admin", "judge", "court_clerk"];

/**
 * area_sqm surfaces from Drizzle as a native `bigint` (or null). JSON.stringify
 * throws on BigInt, so serialise it to a string for the wire. Everything else on
 * the row is already JSON-safe.
 */
function serializeParcel(row: CaseParcelRow): Omit<CaseParcelRow, "areaSqm"> & { areaSqm: string | null } {
  return { ...row, areaSqm: row.areaSqm === null ? null : String(row.areaSqm) };
}

export async function parcelRoutes(app: FastifyInstance): Promise<void> {
  // Attach a parcel to a case.
  app.post("/v1/court/cases/:id/parcels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PARCEL_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = addParcelBody.parse(req.body);
    const result = await commands.addParcel(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's parcels.
  app.get("/v1/court/cases/:id/parcels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PARCEL_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const rows = await repo.listParcelsByCase(ctx.tenantId, id);
    const items = rows.map(serializeParcel);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Update / soft-detach a parcel.
  app.patch("/v1/court/parcels/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PARCEL_WRITE_ROLES);
    const { id } = parcelIdParam.parse(req.params);
    const body = updateParcelBody.parse(req.body);
    const result = await commands.updateParcel(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Cross-case reverse lookup: which cases involve this survey number?
  app.get("/v1/court/parcels/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PARCEL_READ_ROLES);
    const { surveyNumber, limit, offset } = searchQuery.parse(req.query);
    const rows = await repo.searchBySurvey(ctx.tenantId, surveyNumber, limit, offset);
    const items = rows.map(serializeParcel);
    return reply.send({ items, count: items.length, source: "db" });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "parcel route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
