import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, hearingIdParam, scheduleHearingBody, adjournHearingBody, recordHearingOutcomeBody, listHearingsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const HEARING_WRITE_ROLES = ["registrar", "court_admin", "judge", "super_admin"];
const HEARING_READ_ROLES = ["registrar", "court_admin", "judge", "court_clerk", "super_admin"];

export async function hearingRoutes(app: FastifyInstance): Promise<void> {
  // Flat hearings read model (GAP-COURT-HEARINGS-03): a tenant-scoped day view
  // across cases, filterable by date range / status / bench, paginated. This
  // is the CQRS query side powering "today's hearings"; it never leaks across
  // tenants (explicit predicate + RLS) and does not cross court/bench scoping
  // beyond the optional benchId filter.
  app.get("/v1/court/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_READ_ROLES);
    const q = listHearingsQuery.parse(req.query);
    const filters = { tenantId: ctx.tenantId, from: q.from, to: q.to, status: q.status, benchId: q.benchId };
    const [items, total] = await Promise.all([
      repo.listHearings(filters, q.limit, q.offset),
      repo.countHearings(filters),
    ]);
    return reply.send({ items, limit: q.limit, offset: q.offset, count: items.length, total, source: "db" });
  });

  // Schedule a hearing on a case.
  app.post("/v1/court/cases/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = scheduleHearingBody.parse(req.body);
    const result = await commands.scheduleHearing(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's hearings.
  app.get("/v1/court/cases/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listHearingsByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Adjourn a hearing.
  app.patch("/v1/court/hearings/:id/adjourn", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_WRITE_ROLES);
    const { id } = hearingIdParam.parse(req.params);
    const body = adjournHearingBody.parse(req.body);
    const result = await commands.adjournHearing(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Record a hearing outcome (held/cancelled).
  app.patch("/v1/court/hearings/:id/outcome", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HEARING_WRITE_ROLES);
    const { id } = hearingIdParam.parse(req.params);
    const body = recordHearingOutcomeBody.parse(req.body);
    const result = await commands.recordHearingOutcome(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "hearing route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
