import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createCourtBody, listCourtsQuery, createBenchBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

/** Roles permitted to create/mutate the court registry (court administration). */
const COURT_ADMIN_ROLES = ["court_admin", "super_admin"];
/** Roles permitted to read the registry. */
const COURT_READ_ROLES = ["court_admin", "super_admin", "registrar", "judge", "court_clerk"];

export async function courtRegistryRoutes(app: FastifyInstance): Promise<void> {
  // Create a court/authority (write path → command bus, 202 Accepted).
  app.post("/v1/court/courts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_ADMIN_ROLES);
    const body = createCourtBody.parse(req.body);
    const result = await commands.createCourt(ctx, body);
    return reply.code(202).send(result);
  });

  // List courts (read model, tenant-scoped, paginated).
  app.get("/v1/court/courts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const q = listCourtsQuery.parse(req.query);
    const items = await repo.listCourts(
      { tenantId: ctx.tenantId, courtType: q.courtType, parentCourtId: q.parentCourtId },
      q.limit,
      q.offset,
    );
    return reply.send({ items, limit: q.limit, offset: q.offset, count: items.length, source: "db" });
  });

  // Get one court + its benches.
  app.get("/v1/court/courts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const court = await repo.getCourtById(ctx.tenantId, id);
    if (!court) throw new HttpError(404, "COURT_NOT_FOUND", "Court not found");
    const benches = await repo.listBenchesByCourt(ctx.tenantId, id);
    return reply.send({ court, benches, source: "db" });
  });

  // Create a bench under a court.
  app.post("/v1/court/courts/:id/benches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createBenchBody.parse(req.body);
    const result = await commands.createBench(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List benches of a court.
  app.get("/v1/court/courts/:id/benches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const items = await repo.listBenchesByCourt(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Uniform error shaping (mirrors the schema-error-handler envelope).
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "court-registry route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
