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
import * as screeningRepo from "./screening-repo.js";
import { tenantStorage } from "@civitasone/db";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];

export async function recruitmentRoutes(app: FastifyInstance): Promise<void> {
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
    const dedupKey = deriveDedupKey(vacancy, body.email);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createApplication(ctx, body, dedupKey));
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

  // Applications inbox for a specific job opening (HR review).
  app.get("/v1/hrms/job-openings/:id/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await screeningRepo.listApplicationsForVacancy(ctx.tenantId, id);
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
        screeningDecision: r.screeningDecision,
        appliedAt: r.appliedAt,
      })),
      total: rows.length,
    });
  });

  // Recruitment dashboard stats (vacancy counts, source breakdown).
  app.get("/v1/hrms/recruitment/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const openings = await repo.listJobOpeningsByTenant(ctx.tenantId, 500);
    const sourceCounts = await repo.countApplicationsBySource(ctx.tenantId);
    const open = openings.filter((o) => o.status === "open").length;
    const published = openings.filter((o) => o.isPublished === true).length;
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
    // Validate application belongs to this tenant before queuing (same as hire route)
    const existingApp = await repo.findApplicationById(id, ctx.tenantId);
    if (!existingApp) throw new HttpError(404, "NOT_FOUND", "Application not found");
    // Bug 1 hardening: reject an offer on an application that's already
    // offered/hired or in a terminal status (withdrawn/rejected/joined) --
    // fast synchronous feedback for the HTTP caller. repo.claimApplicationForOffer
    // (run from the consumer once this command is processed) re-checks the
    // SAME condition atomically, since this read-then-later-publish has its
    // own race window this synchronous check alone can't close.
    if (repo.NOT_OFFERABLE_STAGES.includes(existingApp.stage) || repo.NOT_OFFERABLE_STATUSES.includes(existingApp.status)) {
      throw new HttpError(409, "INVALID_STATE", `Cannot offer application in stage "${existingApp.stage}" (status "${existingApp.status}")`);
    }
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

  app.setErrorHandler(errorHandler);
}

/**
 * Public careers routes — NO AUTH required. These power the public job board
 * where external candidates can browse published vacancies and apply.
 */
export async function publicRecruitmentRoutes(app: FastifyInstance): Promise<void> {
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
    // Set RLS tenant context from body before repo lookup (public route has no JWT)
    const rawTenantId = (req.body as Record<string, unknown>)?.tenantId;
    let publicTenantId: string | null = null;
    if (typeof rawTenantId === "string" && /^[0-9a-f-]{36}$/i.test(rawTenantId)) {
      publicTenantId = rawTenantId;
      tenantStorage.enterWith({ tenantId: rawTenantId });
    }
    const body = publicApplicationBody.parse(req.body);
    // Use published-only lookup: unpublished jobs surface as 404, not 409 (no existence leak)
    const vacancy = publicTenantId ? await repo.findPublishedOpening(body.jobOpeningId, publicTenantId) : null;
    if (!vacancy) throw new HttpError(404, "NOT_FOUND", "This vacancy is not accepting applications");
    // R-RA-0069: no applications after closure (deadline / max-applicants etc.)
    if (!isApplicationOpen(vacancy as never, Date.now())) {
      throw new HttpError(409, "VACANCY_CLOSED", applicationClosedReason(vacancy as never, Date.now()));
    }
    const dedupKey = deriveDedupKey(vacancy, body.email);
    const result = await commands.createPublicApplication(vacancy.tenantId, body, dedupKey);
    return reply.code(202).send(result);
  });

  app.setErrorHandler(errorHandler);
}

/**
 * Bug 2 hardening: the same dedup_key derivation eligibility-routes.ts
 * already uses for its own (separate) apply path -- lower(email) unless the
 * vacancy's advertised eligibility criteria explicitly sets allowMultiple,
 * else null. The DB's existing partial unique index
 * (hrms_applications_dedup_uq on tenant_id, job_opening_id, dedup_key WHERE
 * dedup_key IS NOT NULL AND status <> 'withdrawn') does the actual
 * enforcement once this is set on insert (see consumer.ts). No email, or no
 * vacancy/criteria to read (e.g. HR recording against an id that turns out
 * not to exist) -> null (can't dedupe on nothing; matches eligibility-routes.ts's
 * own "unless explicitly allowed" default otherwise).
 */
function deriveDedupKey(vacancy: { eligibility?: unknown } | null | undefined, email: string | undefined): string | null {
  const allowMultiple = (vacancy?.eligibility as { allowMultiple?: boolean } | undefined)?.allowMultiple === true;
  if (allowMultiple || !email) return null;
  return email.toLowerCase();
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
