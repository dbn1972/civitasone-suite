import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { JobOpeningSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createJobOpeningBody, createApplicationBody, publicApplicationBody, offerApplicationBody, hireApplicationBody, idParam } from "./validators.js";
import { assertKnownEngagementType } from "../employee/engagement-policy.js";
import { isApplicationOpen, applicationClosedReason } from "./job-publication.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];

export async function recruitmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/recruitment/jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listJobOpenings(ctx.tenantId, q.limit);
    return reply.send({ data: result, meta: { page: 1, pageSize: q.limit, total: result.length } });
  });

  app.get("/v1/hrms/job-openings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, JobOpeningSummaryListSchema, await queries.listJobOpenings(ctx.tenantId, q.limit));
  });

  app.post("/v1/hrms/job-openings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createJobOpeningBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createJobOpening(ctx, body));
  });

  app.post("/v1/hrms/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = createApplicationBody.parse(req.body);
    // R-RA-0069: no applications after closure. HR-assisted path — enforce open
    // status + deadline, but NOT public-published (HR may record against internal
    // / unpublished openings). requirePublished=false.
    const vacancy = await repo.findJobOpeningById(body.jobOpeningId);
    if (vacancy && !isApplicationOpen(vacancy as never, Date.now(), false)) {
      throw new HttpError(409, "VACANCY_CLOSED", applicationClosedReason(vacancy as never, Date.now()));
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createApplication(ctx, body));
  });

  // Talent pool: search all applications across openings (filter by skill, experience, source).
  app.get("/v1/hrms/talent-pool", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const talentPoolQuerySchema = z.object({
      skill: z.string().optional(),
      minExp: z.string().regex(/^\d+$/).optional().transform(Number),
      source: z.string().optional(),
      limit: z.string().regex(/^\d+$/).optional().transform(Number),
    });
    const q = talentPoolQuerySchema.parse(req.query);
    const rows = await repo.searchApplications(ctx.tenantId, {
      skill: q.skill || undefined,
      minExp: q.minExp ? Number(q.minExp) : undefined,
      source: q.source || undefined,
    } as { skill?: string; minExp?: number; source?: string }, Math.min(200, Number(q.limit) || 100));
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        applicantName: r.applicantName,
        email: r.email,
        mobile: r.mobile,
        qualification: r.qualification,
        experienceYears: r.experienceYears,
        skills: r.skills,
        source: r.source,
        stage: r.stage,
        jobOpeningId: r.jobOpeningId,
        appliedAt: r.appliedAt,
      })),
    });
  });

  // Recruitment dashboard stats (vacancy counts, source breakdown).
  app.get("/v1/hrms/recruitment/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const openings = await repo.listJobOpeningsByTenant(ctx.tenantId, 500);
    const sourceCounts = await repo.countApplicationsBySource(ctx.tenantId);
    const open = openings.filter((o) => o.status === "open").length;
    const published = openings.filter((o) => o.isPublished === "true").length;
    const internships = openings.filter((o) => o.vacancyType === "internship" || o.vacancyType === "apprenticeship").length;
    return reply.send({
      totalOpenings: openings.length,
      openVacancies: open,
      publishedVacancies: published,
      internshipsApprenticeships: internships,
      applicationsInternal: sourceCounts.internal,
      applicationsPublic: sourceCounts.public,
    });
  });

  app.patch("/v1/hrms/applications/:id/offer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = offerApplicationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.offerApplication(ctx, id, body));
  });

  app.post("/v1/hrms/applications/:id/hire", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = hireApplicationBody.parse(req.body);

    // Validate the application exists and is in a hireable state first (cheap
    // 404/409 before the engagement-type catalogue reads).
    const application = await repo.findApplicationById(id, ctx.tenantId);
    if (!application) throw new HttpError(404, "NOT_FOUND", "Application not found");
    if (application.stage !== "selected" && application.stage !== "offered") {
      throw new HttpError(409, "INVALID_STATE", `Cannot hire application in stage "${application.stage}"`);
    }
    await assertKnownEngagementType(ctx.tenantId, body.employeeType);

    return sendAccepted(reply, acceptedResponseSchema, await commands.hireApplication(ctx, id, body));
  });


  // GET /v1/hrms/applications/:id — fetch a single application by ID (PPL-D2 fix)
  app.get("/v1/hrms/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const application = await repo.findApplicationById(id, ctx.tenantId);
    if (!application) throw new HttpError(404, "NOT_FOUND", "Application not found");
    return reply.send(application);
  });

  // GET /v1/hrms/job-openings/:id — job opening detail with its applications list
  app.get("/v1/hrms/job-openings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    // Use tenant-scoped lookup (repo.findJobOpeningById has no tenant filter)
    const opening = await repo.findJobOpeningByTenant(id, ctx.tenantId);
    if (!opening) throw new HttpError(404, "NOT_FOUND", "Job opening not found");
    // Fetch applications specifically for this opening (avoids cross-opening truncation)
    const applications = await repo.listApplicationsByJobOpening(ctx.tenantId, id, 500);
    return reply.send({ ...opening, applications });
  });

  app.setErrorHandler(errorHandler);
}

/**
 * Public careers routes — NO AUTH required. These power the public job board
 * where external candidates can browse published vacancies and apply.
 */
export async function publicRecruitmentRoutes(app: FastifyInstance): Promise<void> {
  // List published jobs for a tenant (public, no auth).
  app.get("/v1/careers/jobs", { config: { public: true } }, async (req, reply) => {
    const tenantId = (req.query as { tenantId?: string })?.tenantId
      || (req.headers["x-tenant-id"] as string | undefined)
      || "";
    if (!tenantId) throw new HttpError(400, "MISSING_TENANT", "tenantId is required");
    const vacancies = await queries.listPublishedVacancies(tenantId);
    return reply.send({ data: vacancies, meta: { page: 1, pageSize: vacancies.length, total: vacancies.length } });
  });

  // List published vacancies for a tenant (public, no auth).
  // Requires x-tenant-id header (set by the gateway for the custom domain or by the web proxy).
  app.get("/v1/careers/vacancies", { config: { public: true } }, async (req, reply) => {
    const tenantId = (req.query as { tenantId?: string })?.tenantId
      || (req.headers["x-tenant-id"] as string | undefined)
      || "";
    if (!tenantId) throw new HttpError(400, "MISSING_TENANT", "tenantId is required");
    const vacancies = await queries.listPublishedVacancies(tenantId);
    return reply.send({ data: vacancies });
  });

  // Get a single vacancy's detail (public).
  app.get("/v1/careers/vacancies/:id", { config: { public: true } }, async (req, reply) => {
    const tenantId = (req.query as { tenantId?: string })?.tenantId
      || (req.headers["x-tenant-id"] as string | undefined)
      || "";
    if (!tenantId) throw new HttpError(400, "MISSING_TENANT", "tenantId is required");
    const { id } = idParam.parse(req.params);
    const vacancy = await queries.getPublishedVacancy(id, tenantId);
    if (!vacancy) throw new HttpError(404, "NOT_FOUND", "vacancy not found or not published");
    return reply.send(vacancy);
  });

  // Apply to a published vacancy (public, no auth). Source = "public_portal".
  app.post("/v1/careers/apply", { config: { public: true } }, async (req, reply) => {
    const body = publicApplicationBody.parse(req.body);
    // Resolve tenant from the vacancy
    const vacancy = await repo.findJobOpeningById(body.jobOpeningId);
    if (!vacancy) throw new HttpError(404, "NOT_FOUND", "This vacancy is not accepting applications");
    // R-RA-0069: no applications after closure (status/publish + closing deadline).
    if (!isApplicationOpen(vacancy as never, Date.now())) {
      throw new HttpError(409, "VACANCY_CLOSED", applicationClosedReason(vacancy as never, Date.now()));
    }
    const result = await commands.createPublicApplication(vacancy.tenantId, body);
    return reply.code(201).send(result);
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
