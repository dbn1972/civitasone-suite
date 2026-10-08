import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do"];
// Unmasked PAN is DPDP-sensitive: narrower than WRITE_ROLES (no works_operator).
const PII_REVEAL_ROLES = ["works_admin", "super_admin", "dao", "do"];
const READ_ROLES  = [...WRITE_ROLES, "works_viewer", "sdo", "section_officer", "estimator"];

export async function contractorRoutes(app: FastifyInstance): Promise<void> {
  // List contractors
  app.get("/v1/works/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = v.listQuerySchema.parse(req.query);
    const data = await repo.listContractors(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data, meta: { limit: q.limit, offset: q.offset } });
  });

  // Get contractor by id
  app.get("/v1/works/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const row = await repo.findContractorById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    return reply.send({ data: row });
  });

  // Get contractor rating history
  app.get("/v1/works/contractors/:id/rating-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const { limit } = v.listQuerySchema.parse(req.query);
    const rows = await repo.listRatingHistory(ctx.tenantId, id, Math.min(limit, 100));
    return reply.send({ data: rows });
  });

  // Create contractor
  app.post("/v1/works/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createContractorSchema.parse(req.body);
    const result = await commands.createContractor(ctx, body);
    return reply.status(202).send(result);
  });

  // Rate contractor (performance rating 1–5)
  app.patch("/v1/works/contractors/:id/rate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.rateContractorSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    const result = await commands.rateContractor(ctx, id, body.rating, body.comment);
    return reply.status(202).send(result);
  });

  // Reveal a contractor's clear PAN (DPDP: role-gated + reason-audited).
  app.post("/v1/works/contractors/:id/reveal-pan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PII_REVEAL_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.revealPanSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    const { value } = await commands.revealContractorPan(ctx, id, body.reason);
    reply.header("cache-control", "no-store");
    return reply.send({ data: { value } });
  });

  // Update contractor basic info
  //
  // GAP2-WORKS-CONTRACTORS-03: this edit now routes through the CQRS command
  // path (publish works.contractor.update → consumer applies + emits
  // audit.event.record in one tx) instead of writing to Postgres directly in
  // the handler and returning 200 with no audit event. Existence is checked
  // here for a fast 404; the consumer re-asserts it authoritatively.
  app.patch("/v1/works/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.updateContractorSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    const patch = Object.fromEntries(
      Object.entries(body).filter(([, val]) => val !== undefined),
    ) as Record<string, unknown>;
    const result = await commands.updateContractor(ctx, id, patch);
    return reply.status(202).send(result);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError)
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError)
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
