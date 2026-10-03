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
import * as settingsRepo from "./settings-repo.js";
import { isPublicResumeKey } from "./careers-resume.js";
import { maskEmail, maskMobile } from "./pii-mask.js";
import { resolveDeptScope } from "./dept-scope.js";
import { tenantStorage } from "@civitasone/db";
import { writeAuditLog } from "../../shared/audit.js";
import * as editionPolicyRepo from "./edition-policy-repo.js";
import { REQUISITION_REQUIRED_MESSAGE } from "./edition-policy.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];
// Date of birth is PII not needed to process an application -- narrower than HR_ROLES.
const DOB_ROLES = ["hr_admin", "super_admin"];

export async function recruitmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/job-openings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.parse(req.query);
    // HIGH finding: department scoping. A "manager" caller (ALL_ROLES includes
    // it, but it is not in HR_ROLES / TENANT_WIDE_ROLES) previously saw every
    // department's job openings tenant-wide -- the same resolveDeptScope
    // pattern this module already applies to requisitions/interviews
    // (dept-scope.ts), now applied here too. Fails closed (empty list, not an
    // error) when scoping applies but no department could be resolved for the
    // caller, matching interview-routes.ts's own convention for that case.
    const deptScope = await resolveDeptScope(req, ctx);
    const rows = deptScope.tenantWide
      ? await queries.listJobOpenings(ctx.tenantId, q.limit)
      : deptScope.departmentId
        ? await queries.listJobOpenings(ctx.tenantId, q.limit, deptScope.departmentId)
        : [];
    sendValidated(reply, JobOpeningSummaryListSchema, rows);
  });

  app.post("/v1/hrms/job-openings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createJobOpeningBody.parse(req.body);
    // GAP-RECRUITMENT-NEW-06: Govt editions may only create a vacancy by publishing an approved
    // requisition (R-RA-0056) -- direct creation would bypass the approval chain. Enforced here, server-side.
    if ((await editionPolicyRepo.resolvePolicy(ctx.tenantId)).requisitionRequired) {
      throw new HttpError(409, "REQUISITION_REQUIRED", REQUISITION_REQUIRED_MESSAGE);
    }
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
      minExp: z.string().regex(/^\d{1,3}$/).optional().transform(Number),
      source: z.string().optional(),
      limit: z.string().regex(/^\d+$/).optional().transform(Number),
      // GAP-RECRUITMENT-TALENT-POOL-05: real pagination.
      offset: z.string().regex(/^\d+$/).optional().transform(Number),
      // MEDIUM finding: stage filtering. `stage` picks one exact stage;
      // `includeActive=true` opts into the full unfiltered (pre-fix) view.
      // With neither, repo.searchApplications defaults to
      // repo.AVAILABLE_STAGES -- candidates genuinely off the active
      // pipeline (rejected/withdrawn/not_selected), matching the frontend's
      // own existing activeStage distinction (talent-pool/page.tsx).
      stage: z.string().optional(),
      includeActive: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    });
    const q = talentPoolQuerySchema.parse(req.query);
    const pageLimit = Math.min(200, Number(q.limit) || 100);
    const pageOffset = Math.min(100_000, Number(q.offset) || 0);
    const { rows, total } = await repo.searchApplications(ctx.tenantId, {
      skill: q.skill || undefined,
      minExp: q.minExp ? Number(q.minExp) : undefined,
      source: q.source || undefined,
      stage: q.stage || undefined,
      includeActive: q.includeActive,
    } as { skill?: string; minExp?: number; source?: string; stage?: string; includeActive?: boolean }, pageLimit, pageOffset);
    // GAP-RECRUITMENT-TALENT-POOL-02: the office's configured purpose / retention note for this applicant data.
    const settings = await settingsRepo.getSettings(ctx.tenantId);
    return reply.send({
      total,
      limit: pageLimit,
      offset: pageOffset,
      purposeNote: settings.applicantPurposeNote,
      data: rows.map((r) => ({
        id: r.id,
        applicantName: r.applicantName,
        // GAP-RECRUITMENT-TALENT-POOL-02 (DPDP): past applicants tenant-wide -> masked at the API; the full
        // address is only available through the audited reveal-contact endpoint (hr_admin / super_admin).
        email: maskEmail(r.email),
        contactMasked: true,
        // GAP-RECRUITMENT-TALENT-POOL-02: mobile is deliberately NOT returned here -- the
        // talent-pool page does not use it and it is PII for every past applicant tenant-wide.
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

  // GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-05/06: single application for the HR
  // detail page, so it no longer downloads every applicant's PII on the vacancy to show one.
  // Same role gate and tenant scoping as the list route (findApplicationById filters by
  // tenant, so a foreign-tenant id is a 404, never a 403 that would confirm it exists).
  // dateOfBirth is PII and not needed to process an application: it is returned to
  // hr_admin/super_admin only (null for hr_officer). mobile is never returned here.
  app.get("/v1/hrms/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await repo.findApplicationById(id, ctx.tenantId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "Application not found");
    const canSeeDob = ctx.roles.some((role: string) => DOB_ROLES.includes(role));
    // DPDP data-access audit (same pattern as apar/routes.ts): who read which applicant record and
    // whether DOB was included. writeAuditLog is fire-and-forget and never throws.
    void writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorType: null,
      actorRoles: ctx.roles,
      method: req.method,
      path: `/v1/hrms/applications/${r.id}?dob=${canSeeDob ? "included" : "withheld"}`,
      statusCode: 200,
      requestId: (req.headers["x-correlation-id"] as string) ?? req.id,
      ipAddr: req.ip,
    });
    return reply.send({
      id: r.id,
      jobOpeningId: r.jobOpeningId,
      applicationNo: r.applicationNo ?? null,
      applicantName: r.applicantName,
      // GAP-RECRUITMENT-DETAIL-08 (DPDP): masked here; the audited reveal-contact endpoint gives the full address.
      email: maskEmail(r.email),
      contactMasked: true,
      qualification: r.qualification,
      experienceYears: r.experienceYears,
      skills: r.skills,
      source: r.source,
      stage: r.stage,
      status: r.status,
      screeningDecision: r.screeningDecision,
      appliedAt: r.appliedAt,
      category: r.category ?? null,
      dateOfBirth: canSeeDob ? (r.dateOfBirth ?? null) : null,
      hasResume: Boolean(r.resumeRef || r.resumeFileKey),
      // An uploaded file (public apply) that the audited resume-link can open, as opposed to a bare reference.
      resumeViewable: Boolean(r.resumeFileKey),
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
        // GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-02: human-readable reference for the HR UI.
        applicationNo: r.applicationNo ?? null,
        applicantName: r.applicantName,
        // GAP-RECRUITMENT-DETAIL-08 (DPDP): contact details are masked HERE, before they leave the
        // service. The full values are only available through the audited, reason-bearing
        // POST /v1/hrms/applications/:id/reveal-contact.
        email: maskEmail(r.email),
        mobile: maskMobile(r.mobile),
        contactMasked: true,
        // GAP-RECRUITMENT-CAREERS-DETAIL-04: only whether a resume exists; the file is opened via the audited link.
        hasResume: Boolean(r.resumeFileKey),
        qualification: r.qualification,
        experienceYears: r.experienceYears,
        skills: r.skills,
        source: r.source,
        stage: r.stage,
        screeningDecision: r.screeningDecision,
        appliedAt: r.appliedAt,
        // MEDIUM finding: the GOI Reservation Status card needs each
        // application's real reservation category to compute real fill
        // percentages (was previously hardcoded to a decorative 0% -- see
        // apps/web's recruitment/[id]/page.tsx). The column already exists
        // and is already selected (screeningRepo does a plain `.select()`);
        // it just wasn't in this response's field whitelist.
        category: r.category,
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
    // GAP-RECRUITMENT-DETAIL-05: this single-field shortcut releases compensation with NO approval
    // chain. By default (offerWorkflowRequired, per tenant, default ON) it is refused and offers must
    // go through POST /applications/:id/offers -> submit -> approve (maker != checker) -> release.
    // A small-office tenant may switch the policy off in recruitment settings.
    if ((await settingsRepo.getSettings(ctx.tenantId)).offerWorkflowRequired) {
      throw new HttpError(409, "OFFER_WORKFLOW_REQUIRED", "offers must go through the approval workflow (create a draft offer, submit it, and have it approved before release)");
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
    // GAP-RECRUITMENT-CAREERS-DETAIL-04: a resume key is accepted only if this service issued it for THIS tenant.
    if (body.resumeKey && !isPublicResumeKey(body.resumeKey, vacancy.tenantId)) {
      throw new HttpError(422, "INVALID_RESUME", "the uploaded resume reference is not valid; upload the file again");
    }
    const dedupKey = deriveDedupKey(vacancy, body.email);
    // HIGH fix (response-integrity): a prior version of this pre-check caught
    // only SEQUENTIAL duplicates (a second request arriving after the first's
    // row had already landed) — it could not catch genuinely CONCURRENT
    // duplicates, because every concurrent caller reads "no existing
    // application" before any of their inserts land. That gap is closed
    // below in commands.submitPublicApplication, which does the insert
    // synchronously and reports back whichever row the DB's own unique index
    // actually let through — this remains as a cheap fast path that avoids
    // even attempting a write (and, incidentally, an unnecessary PII-encrypt
    // cycle) for the common case of an obvious prior duplicate.
    if (dedupKey) {
      const existing = await repo.findApplicationByDedupKey(vacancy.tenantId, body.jobOpeningId, dedupKey);
      if (existing) {
        throw new HttpError(409, "DUPLICATE_APPLICATION", "an application for this vacancy already exists for this email",
          { applicationId: existing.id, applicationNo: existing.applicationNo });
      }
    }
    const result = await commands.submitPublicApplication(vacancy.tenantId, body, dedupKey);
    if (result.alreadyApplied) {
      // Lost a genuine concurrent dedup race (see submitPublicApplication) —
      // tell this caller about the real application that won, the same way
      // the pre-check above does, rather than a fabricated id.
      throw new HttpError(409, "DUPLICATE_APPLICATION", "an application for this vacancy already exists for this email",
        { applicationId: result.id, applicationNo: result.applicationNo });
    }
    return reply.code(202).send({ id: result.id, applicationNo: result.applicationNo, status: result.status });
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
 * enforcement once this is set on insert (see consumer.ts for the internal
 * apply path, commands.ts's submitPublicApplication for this one). No email, or no
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
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false, ...(err.details ?? {}) });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
