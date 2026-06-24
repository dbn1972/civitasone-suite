/**
 * Seniority + DPC (Departmental Promotion Committee) eligibility lists.
 *
 *  GET /v1/hrms/seniority?departmentId=&designationId=
 *      Ranked seniority list. Order: date_of_joining ASC (earlier = senior),
 *      tie-break date_of_birth ASC (older = senior), then merit (overall APAR
 *      grade) DESC as final tie-break.
 *
 *  GET /v1/hrms/dpc/eligibility?designationId=&minQualifyingYears=&asOf=
 *      Eligibility list for promotion: filters the seniority list to officers
 *      with at least `minQualifyingYears` of qualifying service in the grade
 *      (measured from date_of_joining, or confirmation_date if present) as of
 *      `asOf` (default today). Returns eligible + ineligible buckets.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsAppraisals } from "../appraisals/schema.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

function yearsBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  return (to - from) / (365.25 * 24 * 3600 * 1000);
}

interface Ranked {
  rank: number;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  designationId: string;
  departmentId: string;
  dateOfJoining: string;
  dateOfBirth: string | null;
  meritGrade: number | null;
  qualifyingYears: number;
}

async function buildSeniority(
  tenantId: string,
  filter: { departmentId?: string; designationId?: string },
  asOf: string,
): Promise<Ranked[]> {
  const rows = await db.select().from(hrmsEmployees).where(eq(hrmsEmployees.tenantId, tenantId));

  // latest overall APAR grade per employee = merit signal
  const appraisals = await db.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.tenantId, tenantId));
  const meritByEmp = new Map<string, number>();
  for (const a of appraisals) {
    if (a.overallGrade == null) continue;
    const g = Number(a.overallGrade);
    const prev = meritByEmp.get(a.employeeId);
    if (prev === undefined || g > prev) meritByEmp.set(a.employeeId, g);
  }

  const filtered = rows.filter((e) => {
    if (filter.departmentId && e.departmentId !== filter.departmentId) return false;
    if (filter.designationId && e.designationId !== filter.designationId) return false;
    return e.status !== "separated";
  });

  filtered.sort((a, b) => {
    // 1. date of joining ASC
    if (a.dateOfJoining !== b.dateOfJoining) return a.dateOfJoining < b.dateOfJoining ? -1 : 1;
    // 2. date of birth ASC (older first)
    const adob = a.dateOfBirth ?? "9999-12-31";
    const bdob = b.dateOfBirth ?? "9999-12-31";
    if (adob !== bdob) return adob < bdob ? -1 : 1;
    // 3. merit grade DESC
    const am = meritByEmp.get(a.id) ?? -1;
    const bm = meritByEmp.get(b.id) ?? -1;
    if (am !== bm) return bm - am;
    return a.employeeNo < b.employeeNo ? -1 : 1;
  });

  return filtered.map((e, i) => ({
    rank: i + 1,
    employeeId: e.id,
    employeeNo: e.employeeNo,
    fullName: e.fullName,
    designationId: e.designationId,
    departmentId: e.departmentId,
    dateOfJoining: e.dateOfJoining,
    dateOfBirth: e.dateOfBirth ?? null,
    meritGrade: meritByEmp.get(e.id) ?? null,
    qualifyingYears: Math.round(yearsBetween(e.confirmationDate ?? e.dateOfJoining, asOf) * 100) / 100,
  }));
}

export async function seniorityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/seniority", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      departmentId: z.string().uuid().optional(),
      designationId: z.string().uuid().optional(),
      asOf: z.string().optional(),
    }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    const filter: { departmentId?: string; designationId?: string } = {};
    if (q.departmentId) filter.departmentId = q.departmentId;
    if (q.designationId) filter.designationId = q.designationId;
    const list = await buildSeniority(ctx.tenantId, filter, asOf);
    return reply.send({ asOf, count: list.length, data: list });
  });

  app.get("/v1/hrms/dpc/eligibility", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      departmentId: z.string().uuid().optional(),
      designationId: z.string().uuid().optional(),
      minQualifyingYears: z.coerce.number().min(0).max(40).default(5),
      asOf: z.string().optional(),
    }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    const filter: { departmentId?: string; designationId?: string } = {};
    if (q.departmentId) filter.departmentId = q.departmentId;
    if (q.designationId) filter.designationId = q.designationId;
    const list = await buildSeniority(ctx.tenantId, filter, asOf);
    const eligible = list.filter((r) => r.qualifyingYears >= q.minQualifyingYears)
      .map((r, i) => ({ ...r, eligibilityRank: i + 1 }));
    const ineligible = list.filter((r) => r.qualifyingYears < q.minQualifyingYears);
    return reply.send({
      asOf, minQualifyingYears: q.minQualifyingYears,
      eligibleCount: eligible.length, ineligibleCount: ineligible.length,
      eligible, ineligible,
    });
  });

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
