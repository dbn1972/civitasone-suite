/**
 * Module 7 tenant-wide list endpoints.
 * These flat-list GET routes match what the frontend pages expect —
 * the existing routes only expose per-employee (:id) paths or use
 * the /lifecycle/ prefix the frontend doesn't include.
 */
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../employee/schema.js";
import { hrmsTransfers, hrmsPromotions, hrmsSeparations } from "../lifecycle/schema.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import { hrmsDeputations } from "../deputation/schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

async function batchEmployees(
  tenantId: string,
  employeeIds: string[],
): Promise<Map<string, { fullName: string; departmentId: string; designationId: string; dateOfJoining: string }>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await scopedRead((tx) =>
    tx
      .select({ id: hrmsEmployees.id, fullName: hrmsEmployees.fullName, departmentId: hrmsEmployees.departmentId, designationId: hrmsEmployees.designationId, dateOfJoining: hrmsEmployees.dateOfJoining })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, tenantId), inArray(hrmsEmployees.id, employeeIds))),
  );
  return new Map(rows.map((e) => [e.id, e]));
}

async function batchDepartments(tenantId: string, deptIds: string[]): Promise<Map<string, string>> {
  if (deptIds.length === 0) return new Map();
  const rows = await scopedRead((tx) =>
    tx
      .select({ id: hrmsDepartments.id, name: hrmsDepartments.name })
      .from(hrmsDepartments)
      .where(and(eq(hrmsDepartments.tenantId, tenantId), inArray(hrmsDepartments.id, deptIds))),
  );
  return new Map(rows.map((d) => [d.id, d.name]));
}

async function batchDesignations(tenantId: string, desigIds: string[]): Promise<Map<string, string>> {
  if (desigIds.length === 0) return new Map();
  const rows = await scopedRead((tx) =>
    tx
      .select({ id: hrmsDesignations.id, name: hrmsDesignations.name })
      .from(hrmsDesignations)
      .where(and(eq(hrmsDesignations.tenantId, tenantId), inArray(hrmsDesignations.id, desigIds))),
  );
  return new Map(rows.map((d) => [d.id, d.name]));
}

export async function m7ListRoutes(app: FastifyInstance): Promise<void> {
  // Transfer list — frontend calls GET /api/v1/hrms/transfers (no /lifecycle/ prefix)
  app.get("/v1/hrms/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsTransfers).where(eq(hrmsTransfers.tenantId, ctx.tenantId)).orderBy(hrmsTransfers.effectiveDate, hrmsTransfers.id).limit(500),
    );
    if (rows.length === 0) return reply.send({ data: [] });
    const empMap = await batchEmployees(ctx.tenantId, [...new Set(rows.map((r) => r.employeeId))]);
    const data = rows.map((r) => ({
      id: r.id,
      employee: empMap.get(r.employeeId)?.fullName ?? "—",
      fromOffice: r.fromStation ?? r.fromDeptId ?? "—",
      toOffice: r.toStation ?? r.toDeptId ?? "—",
      transferDate: r.effectiveDate,
      orderNo: r.orderNo ?? r.orderRef ?? "—",
      relievingDate: r.relievedDate ?? "—",
      status: r.status,
    }));
    return reply.send({ data, hasMore: rows.length === 500 });
  });

  // Promotion list — frontend calls GET /api/v1/hrms/promotions (no /lifecycle/ prefix)
  app.get("/v1/hrms/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsPromotions).where(eq(hrmsPromotions.tenantId, ctx.tenantId)).orderBy(hrmsPromotions.effectiveDate, hrmsPromotions.id).limit(500),
    );
    if (rows.length === 0) return reply.send({ data: [] });
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const empMap = await batchEmployees(ctx.tenantId, empIds);
    const desigIds = [
      ...new Set([
        ...rows.map((r) => r.fromDesigId).filter(Boolean) as string[],
        ...rows.map((r) => r.toDesigId).filter(Boolean) as string[],
      ]),
    ];
    const desigMap = await batchDesignations(ctx.tenantId, desigIds);
    const deptIds = [...new Set([...empMap.values()].map((e) => e.departmentId))];
    const deptMap = await batchDepartments(ctx.tenantId, deptIds);
    const data = rows.map((r) => {
      const emp = empMap.get(r.employeeId);
      return {
        id: r.id,
        employee: emp?.fullName ?? "—",
        department: emp ? (deptMap.get(emp.departmentId) ?? "—") : "—",
        fromGrade: r.fromDesigId ? (desigMap.get(r.fromDesigId) ?? "—") : "—",
        toGrade: r.toDesigId ? (desigMap.get(r.toDesigId) ?? "—") : "—",
        effectiveDate: r.effectiveDate,
        orderNo: r.orderRef ?? "—",
        status: r.status,
      };
    });
    return reply.send({ data, hasMore: rows.length === 500 });
  });

  // Service book tenant-wide list — frontend calls GET /api/v1/hrms/service-book
  // Optional ?employeeId= scopes it to one employee (used by the employee
  // profile's "Service Book" quick-action deep link, which previously always
  // showed the whole tenant's entries with no way to filter to just one person).
  app.get("/v1/hrms/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsServiceBookEntries).where(
        q.employeeId
          ? and(eq(hrmsServiceBookEntries.tenantId, ctx.tenantId), eq(hrmsServiceBookEntries.employeeId, q.employeeId))
          : eq(hrmsServiceBookEntries.tenantId, ctx.tenantId),
      ).orderBy(hrmsServiceBookEntries.effectiveDate, hrmsServiceBookEntries.id).limit(1000),
    );
    if (rows.length === 0) return reply.send({ data: [] });
    const empMap = await batchEmployees(ctx.tenantId, [...new Set(rows.map((r) => r.employeeId))]);
    const data = rows.map((r) => ({
      id: r.id,
      employee: empMap.get(r.employeeId)?.fullName ?? "—",
      eventType: r.entryType,
      fromPosting: "—",
      toPosting: r.description,
      effectiveDate: r.effectiveDate,
      orderNo: r.documentRef ?? "—",
      status: r.attested ? "attested" : "recorded",
    }));
    return reply.send({ data, hasMore: rows.length === 1000 });
  });

  // Deputation list — frontend calls GET /api/v1/hrms/deputation (singular, no employee scope)
  app.get("/v1/hrms/deputation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.tenantId, ctx.tenantId)).orderBy(hrmsDeputations.tenureFrom, hrmsDeputations.id).limit(500),
    );
    if (rows.length === 0) return reply.send({ data: [] });
    const empMap = await batchEmployees(ctx.tenantId, [...new Set(rows.map((r) => r.employeeId))]);
    const data = rows.map((r) => {
      const from = r.tenureFrom;
      const to = r.tenureTo;
      const months = from && to
        ? Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24 * 30)))
        : 0;
      return {
        id: r.id,
        employee: empMap.get(r.employeeId)?.fullName ?? "—",
        parentOrg: r.parentCadre,
        deputationOrg: r.borrowingDepartment,
        fromDate: r.tenureFrom,
        toDate: r.tenureTo,
        period: months > 0 ? `${months} mo` : "—",
        status: r.status,
      };
    });
    return reply.send({ data, hasMore: rows.length === 500 });
  });

  // Probation confirmations — employees on probation whose confirmation is due
  app.get("/v1/hrms/confirmations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const employees = await scopedRead((tx) =>
      tx
        .select({
          id: hrmsEmployees.id,
          fullName: hrmsEmployees.fullName,
          departmentId: hrmsEmployees.departmentId,
          dateOfJoining: hrmsEmployees.dateOfJoining,
          confirmationDate: hrmsEmployees.confirmationDate,
          status: hrmsEmployees.status,
        })
        .from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.status, "probation")))
        .orderBy(hrmsEmployees.dateOfJoining, hrmsEmployees.id)
        .limit(500),
    );
    if (employees.length === 0) return reply.send({ data: [] });
    const deptIds = [...new Set(employees.map((e) => e.departmentId))];
    const deptMap = await batchDepartments(ctx.tenantId, deptIds);
    const data = employees.map((e) => {
      // Probation period: 2 years from joining date
      const join = e.dateOfJoining;
      const probationEnd = join
        ? new Date(new Date(join + "T00:00:00Z").setUTCFullYear(new Date(join + "T00:00:00Z").getUTCFullYear() + 2))
            .toISOString()
            .slice(0, 10)
        : "—";
      return {
        id: e.id,
        employee: e.fullName,
        department: deptMap.get(e.departmentId) ?? "—",
        joiningDate: e.dateOfJoining ?? "—",
        probationEnd,
        dueDate: e.confirmationDate ?? probationEnd,
        status: "probation",
      };
    });
    return reply.send({ data, hasMore: employees.length === 500 });
  });

  // Retirement / separation queue — hrmsSeparations joined with employee data
  app.get("/v1/hrms/retirements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsSeparations).where(eq(hrmsSeparations.tenantId, ctx.tenantId)).orderBy(hrmsSeparations.effectiveDate, hrmsSeparations.id).limit(500),
    );
    if (rows.length === 0) return reply.send({ data: [] });
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const empMap = await batchEmployees(ctx.tenantId, empIds);
    const desigIds = [...new Set([...empMap.values()].map((e) => e.designationId).filter(Boolean) as string[])];
    const desigMap = await batchDesignations(ctx.tenantId, desigIds);
    const deptIds = [...new Set([...empMap.values()].map((e) => e.departmentId))];
    const deptMap = await batchDepartments(ctx.tenantId, deptIds);
    const data = rows.map((r) => {
      const emp = empMap.get(r.employeeId);
      return {
        id: r.id,
        employee: emp?.fullName ?? "—",
        department: emp ? (deptMap.get(emp.departmentId) ?? "—") : "—",
        designation: emp?.designationId ? (desigMap.get(emp.designationId) ?? "—") : "—",
        superannuationDate: r.effectiveDate,
        separationType: r.separationType,
        status: r.status,
      };
    });
    return reply.send({ data, hasMore: rows.length === 500 });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) { return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }); }
    if (err instanceof HttpError) { return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false }); }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
