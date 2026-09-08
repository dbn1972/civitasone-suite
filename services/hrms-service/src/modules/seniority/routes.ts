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
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { buildSeniority } from "./engine.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

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
