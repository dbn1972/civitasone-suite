/**
 * Deputation lifecycle (depute-out / repatriate).
 *
 *  POST /v1/hrms/employees/:id/deputations          create (depute OUT)
 *  GET  /v1/hrms/employees/:id/deputations          list for employee
 *  GET  /v1/hrms/deputations/:depId                 read one
 *  POST /v1/hrms/deputations/:depId/repatriate      repatriate (close, restore parent posting)
 *  POST /v1/hrms/deputations/:depId/cancel          cancel (restore parent posting)
 *
 * On depute-OUT the employee's effective reporting (managerId) and posting
 * (departmentId) are switched to the borrowing assignment, and the parent
 * values are snapshotted on the deputation row. On repatriation/cancel the
 * snapshot is restored. The deputation (duty) allowance is stored in paise.
 * Service-book entries are written for both depute and repatriation.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import * as repo from "./repo.js";
import type { DeputationRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const depParam = z.object({ depId: z.string().uuid() });

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

async function mustEmployee(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
  const emp = rows[0];
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  return emp;
}

async function mustDeputation(tenantId: string, depId: string): Promise<DeputationRow> {
  const dep = await repo.findById(tenantId, depId);
  if (!dep) throw new HttpError(404, "NOT_FOUND", "deputation not found");
  return dep;
}

export async function deputationRoutes(app: FastifyInstance): Promise<void> {
  // --- depute OUT -----------------------------------------------------------
  app.post("/v1/hrms/employees/:id/deputations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      parentCadre: z.string().min(1).max(120),
      borrowingDepartment: z.string().min(1).max(160),
      borrowingDepartmentId: z.string().uuid().optional(),
      borrowingManagerId: z.string().uuid().optional(),
      deputationAllowanceMinor: z.coerce.number().int().min(0).default(0),
      tenureFrom: z.string(),
      tenureTo: z.string(),
      orderRef: z.string().max(120).optional(),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);

    if (new Date(body.tenureTo) <= new Date(body.tenureFrom)) {
      throw new HttpError(400, "INVALID_TENURE", "tenureTo must be after tenureFrom");
    }

    const emp = await mustEmployee(ctx.tenantId, id);
    const existing = await repo.findActiveByEmployee(ctx.tenantId, id);
    if (existing) throw new HttpError(409, "ALREADY_DEPUTED", "employee already has an active deputation");

    const depId = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertDeputation(tx, {
        id: depId, tenantId: ctx.tenantId, employeeId: id,
        parentCadre: body.parentCadre,
        parentDepartmentId: emp.departmentId,
        ...(emp.managerId ? { parentManagerId: emp.managerId } : {}),
        borrowingDepartment: body.borrowingDepartment,
        ...(body.borrowingDepartmentId ? { borrowingDepartmentId: body.borrowingDepartmentId } : {}),
        ...(body.borrowingManagerId ? { borrowingManagerId: body.borrowingManagerId } : {}),
        deputationAllowanceMinor: BigInt(body.deputationAllowanceMinor),
        tenureFrom: body.tenureFrom, tenureTo: body.tenureTo,
        status: "active",
        ...(body.orderRef ? { orderRef: body.orderRef } : {}),
        ...(body.remarks ? { remarks: body.remarks } : {}),
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });

      // Switch the employee's effective posting/reporting for the deputation.
      const empSet: Record<string, unknown> = { updatedBy: ctx.actorId };
      if (body.borrowingDepartmentId) empSet.departmentId = body.borrowingDepartmentId;
      if (body.borrowingManagerId) empSet.managerId = body.borrowingManagerId;
      await tx.update(hrmsEmployees).set(empSet)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)));

      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: ctx.tenantId, employeeId: id, entryType: "deputation_out",
        effectiveDate: body.tenureFrom,
        description: `Deputed to ${body.borrowingDepartment} (parent cadre ${body.parentCadre}) from ${body.tenureFrom} to ${body.tenureTo}`
          + (body.deputationAllowanceMinor > 0 ? `, deputation allowance Rs ${(body.deputationAllowanceMinor / 100).toLocaleString("en-IN")}/month` : ""),
        recordedBy: ctx.actorId,
        ...(body.orderRef ? { documentRef: body.orderRef } : {}),
      });
    });

    return reply.code(201).send(jsonSafe({
      id: depId, employeeId: id, status: "active",
      parentCadre: body.parentCadre, borrowingDepartment: body.borrowingDepartment,
      deputationAllowanceMinor: BigInt(body.deputationAllowanceMinor),
      tenureFrom: body.tenureFrom, tenureTo: body.tenureTo,
    }));
  });

  app.get("/v1/hrms/employees/:id/deputations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listByEmployee(ctx.tenantId, id);
    return reply.send(jsonSafe({ data: rows }));
  });

  app.get("/v1/hrms/deputations/:depId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { depId } = depParam.parse(req.params);
    const dep = await mustDeputation(ctx.tenantId, depId);
    return reply.send(jsonSafe(dep));
  });

  // --- repatriate / cancel: restore parent posting -------------------------
  async function close(req: FastifyRequest, reply: FastifyReply, newStatus: "repatriated" | "cancelled") {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { depId } = depParam.parse(req.params);
    const body = z.object({
      repatriatedOn: z.string().optional(),
      note: z.string().max(2000).optional(),
    }).parse(req.body ?? {});
    const dep = await mustDeputation(ctx.tenantId, depId);
    if (dep.status !== "active") {
      throw new HttpError(409, "NOT_ACTIVE", `deputation is '${dep.status}', not active`);
    }
    const effectiveDate = body.repatriatedOn ?? new Date().toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      await repo.closeDeputation(tx, ctx.tenantId, depId, {
        status: newStatus,
        repatriatedOn: effectiveDate,
        ...(body.note ? { repatriationNote: body.note } : {}),
        updatedBy: ctx.actorId,
      }, dep.version);

      // Restore the parent posting/reporting snapshot.
      await tx.update(hrmsEmployees).set({
        departmentId: dep.parentDepartmentId,
        managerId: dep.parentManagerId,
        updatedBy: ctx.actorId,
      }).where(and(eq(hrmsEmployees.id, dep.employeeId), eq(hrmsEmployees.tenantId, ctx.tenantId)));

      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: ctx.tenantId, employeeId: dep.employeeId,
        entryType: newStatus === "repatriated" ? "repatriation" : "deputation_cancelled",
        effectiveDate,
        description: newStatus === "repatriated"
          ? `Repatriated from ${dep.borrowingDepartment} back to parent cadre ${dep.parentCadre}`
          : `Deputation to ${dep.borrowingDepartment} cancelled`,
        recordedBy: ctx.actorId,
      });
    });

    return reply.send(jsonSafe({
      id: depId, employeeId: dep.employeeId, status: newStatus, effectiveDate,
    }));
  }

  app.post("/v1/hrms/deputations/:depId/repatriate", (req, reply) => close(req, reply, "repatriated"));
  app.post("/v1/hrms/deputations/:depId/cancel", (req, reply) => close(req, reply, "cancelled"));

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
