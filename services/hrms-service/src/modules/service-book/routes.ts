import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import * as employeeRepo from "../employee/repo.js";
import * as repo from "./repo.js";
import { SERVICE_BOOK_EVENT_TYPES } from "./constants.js";

export const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
// GAP-HR-SERVICE-BOOK-06: "employee" added so a plain employee can reach
// their OWN service book (previously HR/manager only, despite the record
// being the employee's own) -- assertCanReadEmployee below is what actually
// restricts a bare employee caller to their own id; the role list alone
// only gets them past requireRole.
export const READER_ROLES = [...HR_ROLES, "manager", "employee"];

/**
 * Shared read-authorization for one employee's service book, used by both
 * this file's per-id JSON route and the printable route (pdf-routes.ts) so
 * the two can never drift. Before this fix the PDF route had NO scoping at
 * all -- any READER_ROLES-holding caller, including "manager", could pull
 * ANY employee's document purely by id enumeration (GAP-HR-SERVICE-BOOK-01).
 * HR: unrestricted. Manager: own department only. Employee: own record only.
 */
export async function assertCanReadEmployee(ctx: RequestContext, targetEmployeeId: string): Promise<void> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) return;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) throw new HttpError(403, "NO_EMPLOYEE_LINK", "no linked employee record for this actor");
  if (ctx.roles.includes("manager")) {
    const target = await employeeRepo.findById(targetEmployeeId, ctx.tenantId);
    if (!target || target.departmentId !== actorEmp.departmentId) {
      throw new HttpError(403, "FORBIDDEN", "manager access is scoped to their own department");
    }
    return;
  }
  if (actorEmp.id !== targetEmployeeId) {
    throw new HttpError(403, "FORBIDDEN", "employees may only view their own service book");
  }
}

export async function serviceBookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await assertCanReadEmployee(ctx, id);
    const rows = await repo.listServiceBookEntries(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  // GAP-HR-SERVICE-BOOK-06: resolves "my own" service book server-side so the
  // web client never needs to know (or guess/enumerate) the caller's own
  // hrms_employees.id. Kept as its own route rather than overloading the
  // :id route with a magic "me" literal, which would collide with the
  // z.string().uuid() param validator above.
  app.get("/v1/hrms/service-book/me", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    if (!actorEmp) return reply.send({ data: [] });
    const rows = await repo.listServiceBookEntries(ctx.tenantId, actorEmp.id);
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
      // GAP-HR-SERVICE-BOOK-03: was z.string().min(1).max(30) -- a manual
      // POST could invent any code; the web badge map and filter dropdown
      // could then never agree on what to call it. Constrained to exactly
      // the vocabulary every real consumer (lifecycle, deputation, training,
      // pay-matrix) actually writes (see constants.ts).
      entryType: z.enum(SERVICE_BOOK_EVENT_TYPES),
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
