import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Screening & shortlisting — candidate qualification validation (R-RA-0108/0109).
 *
 *   PUT  /v1/hrms/job-openings/:id/qualification-requirement   set the exp+edu requirement
 *   GET  /v1/hrms/job-openings/:id/qualification-requirement   get it
 *   POST /v1/hrms/job-openings/:id/validate-candidate          validate a candidate's exp+edu
 *
 * The requirement (min total / relevant experience, max gap, min education level +
 * disciplines + percentage) is stored per job opening; validate-candidate runs the
 * pure experience + education rules against a supplied candidate profile.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { validateExperience, type Employment, type ExperienceRequirement } from "./experience-domain.js";
import { validateEducation, EDUCATION_LEVELS, type Qualification, type EducationRequirement } from "./education-domain.js";
import * as repo from "./qualification-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

export async function qualificationRoutes(app: FastifyInstance): Promise<void> {
  // ---- set the requirement ---------------------------------------------
  app.put("/v1/hrms/job-openings/:id/qualification-requirement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    const body = z.object({
      minTotalYears: z.coerce.number().min(0).max(60).optional(),
      minRelevantYears: z.coerce.number().min(0).max(60).optional(),
      maxGapMonths: z.coerce.number().int().min(0).max(600).optional(),
      minEducationLevel: z.enum(EDUCATION_LEVELS).optional(),
      requiredDisciplines: z.array(z.string().min(1).max(120)).max(50).optional(),
      minPercentage: z.coerce.number().min(0).max(100).optional(),
      recognisedInstitutionsOnly: z.boolean().optional(),
    }).parse(req.body);
    if (body.minRelevantYears != null && body.minTotalYears != null && body.minRelevantYears > body.minTotalYears) {
      throw new HttpError(422, "INVALID_REQUIREMENT", "minimum relevant years cannot exceed minimum total years");
    }

    const patch = {
      minTotalYears: body.minTotalYears != null ? String(body.minTotalYears) : null,
      minRelevantYears: body.minRelevantYears != null ? String(body.minRelevantYears) : null,
      maxGapMonths: body.maxGapMonths ?? null,
      minEducationLevel: body.minEducationLevel ?? null,
      requiredDisciplines: (body.requiredDisciplines ?? []) as never,
      minPercentage: body.minPercentage != null ? String(body.minPercentage) : null,
      recognisedInstitutionsOnly: body.recognisedInstitutionsOnly ?? false,
      updatedBy: ctx.actorId,
    };
    const existing = await repo.findByJob(ctx.tenantId, jobOpeningId);
    try {
      await publishF3Write(ctx, "recruitment_qualification_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "REQUIREMENT_EXISTS", "a requirement for this job was created concurrently; reload and retry");
      throw e;
    }
    return reply.send({ jobOpeningId, saved: true });
  });

  app.get("/v1/hrms/job-openings/:id/qualification-requirement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    const r = await repo.findByJob(ctx.tenantId, jobOpeningId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "no qualification requirement set for this job opening");
    return reply.send(r);
  });

  // ---- validate a candidate (R-RA-0108/0109) ---------------------------
  app.post("/v1/hrms/job-openings/:id/validate-candidate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    const body = z.object({
      experience: z.array(z.object({
        employer: z.string().min(1).max(256),
        role: z.string().max(256).optional(),
        from: z.string().date(),
        to: z.string().date().nullable().optional(),
        relevant: z.boolean().optional(),
      })).max(100).optional(),
      education: z.array(z.object({
        level: z.string().min(1).max(24),
        discipline: z.string().max(120).optional(),
        institution: z.string().max(256).optional(),
        year: z.coerce.number().int().min(1900).max(2100).optional(),
        percentage: z.coerce.number().min(0).max(100).optional(),
      })).max(50).optional(),
    }).parse(req.body);

    const reqRow = await repo.findByJob(ctx.tenantId, jobOpeningId);
    if (!reqRow) throw new HttpError(409, "NO_REQUIREMENT", "set a qualification requirement for this job opening first");

    const expReq: ExperienceRequirement = {
      ...(reqRow.minTotalYears != null ? { minTotalYears: num(reqRow.minTotalYears)! } : {}),
      ...(reqRow.minRelevantYears != null ? { minRelevantYears: num(reqRow.minRelevantYears)! } : {}),
      ...(reqRow.maxGapMonths != null ? { maxGapMonths: reqRow.maxGapMonths } : {}),
    };
    const experience = validateExperience((body.experience ?? []) as Employment[], expReq, Date.now());

    let education = null;
    if (reqRow.minEducationLevel) {
      const eduReq: EducationRequirement = {
        minLevel: reqRow.minEducationLevel,
        ...(reqRow.requiredDisciplines && reqRow.requiredDisciplines.length > 0 ? { requiredDisciplines: reqRow.requiredDisciplines } : {}),
        ...(reqRow.minPercentage != null ? { minPercentage: num(reqRow.minPercentage)! } : {}),
        recognisedInstitutionsOnly: reqRow.recognisedInstitutionsOnly,
      };
      education = validateEducation((body.education ?? []) as Qualification[], eduReq);
    }

    const eligible = experience.eligible && (education == null || education.eligible);
    return reply.send({ jobOpeningId, eligible, experience, education });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
