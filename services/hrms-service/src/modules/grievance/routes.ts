/**
 * Employee grievance register (GAP-HR-GRIEVANCE-01/02/03/06). CQRS: every
 * write publishes a command and returns 202; the consumer persists + audits.
 *
 *  GET  /v1/hrms/grievances              register (paged, coarse columns only) + stat counts
 *  GET  /v1/hrms/grievances/:id          detail incl. description + history (audited read)
 *  POST /v1/hrms/grievances              register a grievance (case no GRV/YYYY/NNNN assigned on write)
 *  POST /v1/hrms/grievances/:id/assign   assign / re-assign to an HR officer
 *  POST /v1/hrms/grievances/:id/dispose  dispose with a disposition + remarks
 *
 * Role gate mirrors the web page's GRIEVANCE_ROLES. The list never returns the
 * free-text subject/description (DPDP); only the detail does, and each detail
 * read is itself audited.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import { fetchUserRoleKeys } from "../../shared/identity-client.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  GRIEVANCE_CATEGORIES, GRIEVANCE_DISPOSITIONS, GRIEVANCE_STATUSES, canAssign, canDispose,
  countsFromStatusMap, istToday,
} from "./domain.js";

/** Same set as the web page's GRIEVANCE_ROLES. */
export const GRIEVANCE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  status: z.enum(GRIEVANCE_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
const registerBody = z.object({
  employeeId: z.string().uuid(),
  category: z.enum(GRIEVANCE_CATEGORIES),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(5000),
  filedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const assignBody = z.object({
  assigneeEmployeeId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
const disposeBody = z.object({
  disposition: z.enum(GRIEVANCE_DISPOSITIONS),
  remarks: z.string().trim().min(5).max(2000),
});

async function mustEmployee(tenantId: string, id: string, field: string) {
  const rows = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id, userRef: hrmsEmployees.userRef }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
  if (!rows[0]) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", `${field} not found`);
  return rows[0];
}

/** The acting user's own employee id (null when their account is not linked to an employee record). */
async function actorEmployeeId(tenantId: string, actorId: string): Promise<string | null> {
  return (await resolveEmployeeForActor(tenantId, actorId))?.id ?? null;
}

/**
 * Conflict of interest: whoever filed (is the complainant of) a grievance
 * must never read it through the register, assign it, or dispose of it. The
 * check is on the ACTING USER's own employee record, not on the HR role.
 */
function assertNotComplainant(actorEmpId: string | null, complainantId: string): void {
  if (actorEmpId && actorEmpId === complainantId) {
    throw new HttpError(403, "CONFLICT_OF_INTEREST", "you cannot act on a grievance you filed yourself");
  }
}

export async function grievanceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRIEVANCE_ROLES);
    const q = listQuery.parse(req.query);
    // The actor's own complainant cases are not theirs to see here: filtered
    // out of rows, total and counts alike so the numbers still reconcile.
    const own = await actorEmployeeId(ctx.tenantId, ctx.actorId);
    const [{ rows, total }, byStatus] = await Promise.all([
      repo.listGrievances(ctx.tenantId, { ...q, excludeEmployeeId: own }),
      repo.statusCounts(ctx.tenantId, own),
    ]);
    return reply.send({
      data: rows,
      meta: { total, limit: q.limit, offset: q.offset, counts: countsFromStatusMap(byStatus) },
    });
  });

  app.get("/v1/hrms/grievances/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRIEVANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const g = await repo.findById(ctx.tenantId, id);
    if (!g) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    assertNotComplainant(await actorEmployeeId(ctx.tenantId, ctx.actorId), g.employeeId);
    const events = await repo.listEvents(ctx.tenantId, id);
    const names = await repo.employeeNames(ctx.tenantId, [
      g.employeeId, ...(g.assignedTo ? [g.assignedTo] : []), ...events.map((e) => e.assignedTo ?? ""),
    ]);
    // DPDP: opening the free-text description is an auditable access.
    await commands.recordGrievanceRead(ctx, id);
    return reply.send({
      data: {
        id: g.id, caseNo: g.caseNo, employeeId: g.employeeId, employee: names.get(g.employeeId) ?? "—",
        category: g.category, subject: g.subject, description: g.description, filedDate: g.filedDate,
        status: g.status, assignedTo: g.assignedTo, assignedToName: g.assignedTo ? names.get(g.assignedTo) ?? null : null,
        assignedAt: g.assignedAt, disposition: g.disposition, disposalRemarks: g.disposalRemarks,
        disposedAt: g.disposedAt, createdAt: g.createdAt,
        events: events.map((e) => ({
          id: e.id, action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note,
          assignedToName: e.assignedTo ? names.get(e.assignedTo) ?? null : null, createdAt: e.createdAt,
        })),
      },
    });
  });

  app.post("/v1/hrms/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRIEVANCE_ROLES);
    const body = registerBody.parse(req.body);
    const today = istToday();
    const filedDate = body.filedDate ?? today;
    if (filedDate > today) throw new HttpError(422, "FILED_DATE_IN_FUTURE", "filed date cannot be in the future");
    await mustEmployee(ctx.tenantId, body.employeeId, "employee");
    const accepted = await commands.registerGrievance(ctx, {
      employeeId: body.employeeId, category: body.category, subject: body.subject,
      description: body.description, filedDate,
    });
    return reply.code(202).send(accepted);
  });

  app.post("/v1/hrms/grievances/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRIEVANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const g = await repo.findById(ctx.tenantId, id);
    if (!g) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    assertNotComplainant(await actorEmployeeId(ctx.tenantId, ctx.actorId), g.employeeId);
    if (!canAssign(g.status)) throw new HttpError(409, "ALREADY_DISPOSED", "a disposed grievance cannot be assigned");
    if (g.employeeId === body.assigneeEmployeeId) {
      throw new HttpError(422, "CONFLICT_OF_INTEREST", "a grievance cannot be assigned to the employee who filed it");
    }
    const assignee = await mustEmployee(ctx.tenantId, body.assigneeEmployeeId, "assignee");
    // The assignee must actually hold an HR role (reviewer N4): any employee
    // could otherwise be handed a confidential case. Fails closed -- if the
    // identity lookup is unavailable the assignment is refused, not allowed.
    const roleKeys = assignee.userRef ? await fetchUserRoleKeys(ctx.tenantId, assignee.userRef) : [];
    if (roleKeys === undefined) {
      throw new HttpError(503, "ROLE_LOOKUP_UNAVAILABLE", "cannot verify the assignee's role right now; retry shortly");
    }
    if (!roleKeys.some((r) => GRIEVANCE_ROLES.includes(r))) {
      throw new HttpError(422, "ASSIGNEE_NOT_HR_OFFICER", "a grievance can only be assigned to an HR officer");
    }
    return reply.code(202).send(await commands.assignGrievance(ctx, id, body.assigneeEmployeeId, body.note ?? null));
  });

  app.post("/v1/hrms/grievances/:id/dispose", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRIEVANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = disposeBody.parse(req.body);
    const g = await repo.findById(ctx.tenantId, id);
    if (!g) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    assertNotComplainant(await actorEmployeeId(ctx.tenantId, ctx.actorId), g.employeeId);
    if (!canDispose(g.status)) throw new HttpError(409, "ALREADY_DISPOSED", "this grievance is already disposed");
    return reply.code(202).send(await commands.disposeGrievance(ctx, id, body.disposition, body.remarks));
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
