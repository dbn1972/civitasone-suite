import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, registerCaseBody, listCasesQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

/** Roles permitted to register/mutate cases. */
const COURT_WRITE_ROLES = ["registrar", "court_admin", "super_admin"];
/** Roles permitted to read the registry (write roles + read-only court staff). */
const COURT_READ_ROLES = ["registrar", "court_admin", "super_admin", "judge", "court_clerk"];

export async function caseRegistryRoutes(app: FastifyInstance): Promise<void> {
  // Register a new case (write path → command bus, 202 Accepted).
  app.post("/v1/court/cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_WRITE_ROLES);
    const body = registerCaseBody.parse(req.body);
    const result = await commands.registerCase(ctx, body);
    return reply.code(202).send(result);
  });

  // List cases (read model, tenant-scoped, paginated → DataSourceBadge-friendly).
  app.get("/v1/court/cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const q = listCasesQuery.parse(req.query);
    const items = await repo.listCases(
      { tenantId: ctx.tenantId, status: q.status, courtId: q.courtId },
      q.limit,
      q.offset,
    );
    return reply.send({
      items,
      limit: q.limit,
      offset: q.offset,
      count: items.length,
      source: "db",
    });
  });

  // Fetch a single case with its parties.
  // Overdue cases (past SLA target, not disposed) — court MIS / pendency mgmt.
  app.get("/v1/court/cases/overdue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const q = req.query as { asOf?: string; limit?: string; offset?: string };
    const asOf = q.asOf && /^\d{4}-\d{2}-\d{2}$/.test(q.asOf)
      ? q.asOf : new Date().toISOString().slice(0, 10);
    const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const items = await repo.listOverdueCases(ctx.tenantId, asOf, limit, offset);
    return reply.send({ items, count: items.length, asOf, source: "db" });
  });

  // Analytics dashboard summary (NCMS-style clearance rate + pendency age).
  app.get("/v1/court/cases/analytics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const q = req.query as { from?: string; to?: string };
    const rx = /^\d{4}-\d{2}-\d{2}$/;
    const from = q.from && rx.test(q.from) ? q.from : "1970-01-01";
    const to = q.to && rx.test(q.to) ? q.to : new Date().toISOString().slice(0, 10);
    const a = await repo.caseAnalytics(ctx.tenantId, from, to);
    const clearanceRatePct = a.instituted > 0 ? Math.round((a.disposed / a.instituted) * 1000) / 10 : null;
    return reply.send({ period: { from, to }, ...a, clearanceRatePct, source: "db" });
  });

  // Pendency summary — pending-case counts by status.
  app.get("/v1/court/cases/pendency", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const summary = await repo.pendencySummary(ctx.tenantId);
    const total = summary.reduce((a, s) => a + s.count, 0);
    return reply.send({ summary, total, source: "db" });
  });

  app.get("/v1/court/cases/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const found = await repo.getCaseById(ctx.tenantId, id);
    // Tenant guard: never leak a case belonging to another tenant.
    if (!found || found.tenantId !== ctx.tenantId) {
      throw new HttpError(404, "CASE_NOT_FOUND", "case not found");
    }
    const parties = await repo.getCasePartiesByCaseId(id);
    return reply.send({ ...found, parties });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
