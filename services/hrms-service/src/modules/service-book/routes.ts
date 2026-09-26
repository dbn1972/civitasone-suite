import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import * as employeeRepo from "../employee/repo.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

export async function serviceBookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // Dept-scoping (DIFFERENT finding from the sealed-cover/suspended-
    // eligibility gap in seniority/engine.ts -- this only restricts WHICH
    // employee id a manager-only caller may look up, not any ranking or
    // eligibility computation). HR roles are unrestricted, unchanged; a
    // manager-only caller may only read service-book entries for an
    // employee in their OWN department -- otherwise this let a manager
    // pull up any employee's full service-book by id enumeration, tenant-
    // wide, same shape of gap as employee/routes.ts's resolveManagerScope
    // and medical/routes.ts's resolveSelfScopedEmployeeId already closed
    // elsewhere.
    const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
    if (!isHrActor) {
      const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
      if (!actorEmp) throw new HttpError(403, "NO_EMPLOYEE_LINK", "no linked employee record for this actor");
      const target = await employeeRepo.findById(id, ctx.tenantId);
      if (!target || target.departmentId !== actorEmp.departmentId) {
        throw new HttpError(403, "FORBIDDEN", "manager access is scoped to their own department");
      }
    }
    const rows = await repo.listServiceBookEntries(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/employees/:id/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: employeeId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      // SEC-CRIT-002 (trivial companion fix): bound free-text fields to their
      // DB column widths so an oversized value 400s cleanly here instead of
      // failing as a raw DB error later in the async F3 consumer (entry_type
      // is varchar(30), document_ref is varchar(100) -- see schema.ts).
      // description is a text column server-side; cap it to keep entries a
      // genuine service-book note rather than unbounded free text.
      entryType: z.string().min(1).max(30),
      effectiveDate: z.string(),
      description: z.string().min(1).max(2000),
      documentRef: z.string().max(100).optional(),
    }).parse(req.body);
    const entryId = randomUUID();
    await publishF3Write(ctx, "service_book_routes__0", entryId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(202).send({ id: entryId, status: "accepted" }) as any;
  });

  // Edit an entry — refused once the entry has been attested (immutable).
  app.patch("/v1/hrms/service-book/entries/:entryId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { entryId } = z.object({ entryId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      description: z.string().min(1).max(2000),
      documentRef: z.string().max(100).optional(),
    }).parse(req.body);
    const entry = await repo.getEntry(ctx.tenantId, entryId);
    if (!entry) throw new HttpError(404, "NOT_FOUND", "service book entry not found");
    if (entry.attested) throw new HttpError(409, "ATTESTED_IMMUTABLE", "entry is attested and cannot be edited");
    await publishF3Write(ctx, "service_book_routes__1", entryId, {
      body: (req.body as Record<string, unknown>) ?? {},
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id: entryId, status: "accepted", updated: true }) as any;
  });

  // Attestation: competent-authority sign-off, immutable thereafter.
  app.post("/v1/hrms/service-book/entries/:entryId/attest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { entryId } = z.object({ entryId: z.string().uuid() }).parse(req.params);
    const body = z.object({ remarks: z.string().max(1000).optional() }).parse(req.body ?? {});
    const entry = await repo.getEntry(ctx.tenantId, entryId);
    if (!entry) throw new HttpError(404, "NOT_FOUND", "service book entry not found");
    if (entry.attested) throw new HttpError(409, "ALREADY_ATTESTED", "entry is already attested");
    await publishF3Write(ctx, "service_book_routes__2", entryId, {
      body: (req.body as Record<string, unknown>) ?? {},
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id: entryId, status: "accepted", attested: true }) as any;
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
