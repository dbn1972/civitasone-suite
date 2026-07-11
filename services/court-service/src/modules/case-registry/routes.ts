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
  app.get("/v1/court/cases/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COURT_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const found = await repo.getCaseById(id);
    // Tenant guard: never leak a case belonging to another tenant.
    if (!found || found.tenantId !== ctx.tenantId) {
      throw new HttpError(404, "CASE_NOT_FOUND", "case not found");
    }
    const parties = await repo.getCasePartiesByCaseId(id);
    return reply.send({ ...found, parties });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
