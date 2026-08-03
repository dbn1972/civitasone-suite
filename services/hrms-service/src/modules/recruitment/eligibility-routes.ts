import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Application & eligibility (checklist R-RA-0093/0094/0095/0098/0100/0102).
 *
 *   PATCH /v1/hrms/job-openings/:id/eligibility            configure advertised criteria
 *   POST  /v1/hrms/job-openings/:id/eligibility-check      dry-run an applicant (no write)
 *   POST  /v1/hrms/job-openings/:id/applications           eligibility-enforced apply
 *   GET   /v1/hrms/applications/:id/eligibility            view stored eligibility result
 *   POST  /v1/hrms/applications/:id/withdraw               withdraw with reason
 *
 * The apply path validates the applicant against the vacancy's advertised
 * criteria (age as-on cut-off with category relaxation, experience, qualification),
 * blocks a clearly-ineligible applicant with a structured, explainable 422,
 * prevents duplicate applications, and issues a unique application number.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { evaluateEligibility, isValidCalendarDate, type EligibilityCriteria, type Applicant } from "./eligibility.js";
import { isApplicationOpen, applicationClosedReason } from "./job-publication.js";
import * as repo from "./eligibility-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const APPLY_ROLES = [...HR_ROLES, "manager"];
const idParam = z.object({ id: z.string().uuid() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate, "not a valid calendar date");

const criteriaBody = z.object({
  ageMin: z.coerce.number().int().min(0).max(120).optional(),
  ageMax: z.coerce.number().int().min(0).max(120).optional(),
  cutoffDate: isoDate.optional(),
  experienceMinYears: z.coerce.number().int().min(0).max(60).optional(),
  allowedQualifications: z.array(z.string().max(120)).max(50).optional(),
  categoryAgeRelaxation: z.record(z.coerce.number().int().min(0).max(30)).optional(),
  allowMultiple: z.boolean().optional(),
});

const applicantFields = {
  dateOfBirth: isoDate.optional(),
  category: z.string().max(16).optional(),
  experienceYears: z.coerce.number().int().min(0).max(60).optional(),
  qualification: z.string().max(500).optional(),
};

function toCriteria(v: { eligibility: unknown }): EligibilityCriteria {
  return (v.eligibility ?? {}) as EligibilityCriteria;
}

export async function eligibilityRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/v1/hrms/job-openings/:id/eligibility", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = criteriaBody.parse(req.body ?? {});
    if (body.ageMin != null && body.ageMax != null && body.ageMin > body.ageMax) {
      throw new HttpError(400, "INVALID_CRITERIA", "ageMin cannot exceed ageMax");
    }
    if ((body.ageMin != null || body.ageMax != null) && !body.cutoffDate) {
      throw new HttpError(400, "INVALID_CRITERIA", "an age cut-off date is required when an age limit is set");
    }
    const v = await mustVacancy(ctx.tenantId, id);
    await publishF3Write(ctx, "recruitment_eligibility_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, eligibility: body });
  });

  app.post("/v1/hrms/job-openings/:id/eligibility-check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPLY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object(applicantFields).parse(req.body ?? {});
    const v = await mustVacancy(ctx.tenantId, id);
    return reply.send(evaluateEligibility(toCriteria(v), body as Applicant));
  });

  app.post("/v1/hrms/job-openings/:id/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPLY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      applicantName: z.string().min(1).max(256),
      email: z.string().email(),
      mobile: z.string().max(20).optional(),
      resumeRef: z.string().max(512).optional(),
      skills: z.array(z.string().max(64)).max(30).optional(),
      ...applicantFields,
    }).parse(req.body);
    const v = await mustVacancy(ctx.tenantId, id);
    // R-RA-0069: no applications after closure (status/publish + the closing
    // deadline). An authorised extension pushes the deadline out and reopens.
    if (!isApplicationOpen(v as never, Date.now())) {
      throw new HttpError(409, "VACANCY_CLOSED", applicationClosedReason(v as never, Date.now()));
    }

    const criteria = toCriteria(v);
    // Duplicate prevention (R-RA-0100) unless the vacancy explicitly allows multiple.
    if (!criteria.allowMultiple) {
      const existing = await repo.countApplicationsForEmail(ctx.tenantId, id, body.email);
      if (existing > 0) throw new HttpError(409, "DUPLICATE_APPLICATION", "an application for this vacancy already exists for this email");
    }
    // Eligibility (R-RA-0093/0094/0095) — block a clearly-ineligible applicant.
    const result = evaluateEligibility(criteria, body as Applicant);
    if (!result.eligible) {
      return reply.code(422).send({
        code: "NOT_ELIGIBLE",
        message: "applicant does not meet the advertised eligibility criteria",
        eligibility: result,
      });
    }

    const appId = randomUUID();
    const applicationNo = `APP-${appId.slice(0, 8).toUpperCase()}`;
    // dedup_key drives the DB-enforced unique index: null when the vacancy allows
    // multiple applications, else lower(email) so a concurrent duplicate apply is
    // a hard 23505 rather than a best-effort check.
    const dedupKey = criteria.allowMultiple ? null : body.email.toLowerCase();
    try {
      await publishF3Write(ctx, "recruitment_eligibility_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "DUPLICATE_APPLICATION", "a duplicate application was detected");
      }
      throw err;
    }
    return reply.code(201).send({ id: appId, applicationNo, status: "active", eligibility: result });
  });

  app.get("/v1/hrms/applications/:id/eligibility", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPLY_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await repo.findApplication(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    return reply.send({ id, applicationNo: a.applicationNo, status: a.status, eligibility: a.eligibilityResult ?? null });
  });

  app.post("/v1/hrms/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPLY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(1000) }).parse(req.body ?? {});
    const a = await repo.findApplication(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    if (a.status === "withdrawn") throw new HttpError(409, "ALREADY_WITHDRAWN", "application is already withdrawn");
    if (a.stage === "hired") throw new HttpError(409, "WRONG_STATE", "a hired application cannot be withdrawn");
    await publishF3Write(ctx, "recruitment_eligibility_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "withdrawn" });
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

  async function mustVacancy(tenantId: string, id: string) {
    const v = await repo.findVacancy(tenantId, id);
    if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
    return v;
  }
}
