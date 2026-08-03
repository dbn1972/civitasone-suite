import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Job publication & career portal (checklist R-RA-0063/0067/0068/0069/0071).
 *
 *   PATCH /v1/hrms/job-openings/:id/advertisement   set advert details + deadline + scope
 *   POST  /v1/hrms/job-openings/:id/corrigendum     record a corrigendum (preserves original)
 *   POST  /v1/hrms/job-openings/:id/extend          extend the deadline (reopens if closed)
 *   POST  /v1/hrms/job-openings/:id/cancel          cancel the vacancy (preserves advert)
 *   GET   /v1/hrms/job-openings/:id/corrigenda      corrigendum history
 *   GET   /v1/careers/search                         public filtered vacancy search
 *
 * The closing deadline (job_openings.application_deadline) is authoritative for
 * "no applications after closure except authorised extension" (R-RA-0069, enforced
 * on the eligibility apply route). Corrigenda / extensions / cancellations are all
 * logged, preserving the original advertisement (R-RA-0068).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { CORRIGENDUM_ACTIONS } from "./job-publication.js";
import * as repo from "./publication-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

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

export async function jobPublicationRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/v1/hrms/job-openings/:id/advertisement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    // NOTE: applicationDeadline is deliberately NOT settable here — every deadline
    // change must go through /extend so it is corrigendum-logged and forward-only
    // (R-RA-0068). The initial deadline is set when the requisition is published.
    const body = z.object({
      feesMinor: z.coerce.number().int().min(0).optional(),
      feeExemption: z.string().max(2000).optional(),
      requiredDocuments: z.array(z.string().max(200)).max(50).optional(),
      selectionProcess: z.string().max(4000).optional(),
      importantDates: z.record(z.string().max(64)).optional(),
      portalScope: z.enum(["public", "internal", "both"]).optional(),
      titleAlt: z.string().max(300).optional(),
      descriptionAlt: z.string().max(8000).optional(),
      minExperienceYears: z.coerce.number().int().min(0).max(60).optional(),
    }).parse(req.body ?? {});
    const v = await mustVac(ctx.tenantId, id);
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.feesMinor != null) patch.feesMinor = BigInt(body.feesMinor);
    for (const k of ["feeExemption", "requiredDocuments", "selectionProcess", "importantDates", "portalScope", "titleAlt", "descriptionAlt", "minExperienceYears"] as const) {
      if ((body as Record<string, unknown>)[k] !== undefined) patch[k] = (body as Record<string, unknown>)[k];
    }
    await publishF3Write(ctx, "recruitment_publication_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, updated: true }) as any;
  });

  app.post("/v1/hrms/job-openings/:id/corrigendum", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ changes: z.string().min(1).max(4000) }).parse(req.body);
    const v = await mustVac(ctx.tenantId, id);
    if (v.status === "cancelled") throw new HttpError(409, "CANCELLED", "a cancelled vacancy cannot be amended");
    const seq = await repo.nextCorrigendumSeq(ctx.tenantId, id);
    await publishF3Write(ctx, "recruitment_publication_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, corrigendumSeq: seq }) as any;
  });

  app.post("/v1/hrms/job-openings/:id/extend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ newDeadline: z.string().datetime(), reason: z.string().max(2000).optional() }).parse(req.body);
    const v = await mustVac(ctx.tenantId, id);
    if (v.status === "cancelled") throw new HttpError(409, "CANCELLED", "a cancelled vacancy cannot be extended");
    const oldDeadline = v.applicationDeadline as Date | null;
    const newDeadline = new Date(body.newDeadline);
    if (oldDeadline && newDeadline <= oldDeadline) throw new HttpError(400, "NOT_AN_EXTENSION", "the new deadline must be later than the current one");
    const seq = await repo.nextCorrigendumSeq(ctx.tenantId, id);
    await publishF3Write(ctx, "recruitment_publication_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "open", applicationDeadline: newDeadline, corrigendumSeq: seq })) as any;
  });

  app.post("/v1/hrms/job-openings/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(2000) }).parse(req.body);
    const v = await mustVac(ctx.tenantId, id);
    if (v.status === "cancelled") throw new HttpError(409, "ALREADY_CANCELLED", "vacancy is already cancelled");
    const seq = await repo.nextCorrigendumSeq(ctx.tenantId, id);
    await publishF3Write(ctx, "recruitment_publication_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "cancelled" }) as any;
  });

  app.get("/v1/hrms/job-openings/:id/corrigenda", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = idParam.parse(req.params);
    await mustVac(ctx.tenantId, id);
    return reply.send(jsonSafe({ data: await repo.listCorrigenda(ctx.tenantId, id) }));
  });

  // Public career search (R-RA-0071).
  app.get("/v1/careers/search", { config: { public: true } }, async (req, reply) => {
    const q = z.object({
      tenantId: z.string().uuid(),
      keyword: z.string().max(120).optional(),
      location: z.string().max(120).optional(),
      vacancyType: z.string().max(24).optional(),
      minExperience: z.coerce.number().int().min(0).max(60).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);
    const rows = await repo.searchVacancies(q.tenantId, {
      ...(q.keyword ? { keyword: q.keyword } : {}),
      ...(q.location ? { location: q.location } : {}),
      ...(q.vacancyType ? { vacancyType: q.vacancyType } : {}),
      ...(q.minExperience != null ? { minExperience: q.minExperience } : {}),
    }, q.limit ?? 100);
    // Public projection — only advertisement-safe fields.
    return reply.send(jsonSafe({
      data: rows.map((r) => ({
        id: r.id, refNo: r.refNo, title: r.title, titleAlt: r.titleAlt,
        location: r.location, vacancyType: r.vacancyType, vacancies: r.vacancies,
        qualification: r.qualification, minExperienceYears: r.minExperienceYears,
        feesMinor: r.feesMinor, selectionProcess: r.selectionProcess, importantDates: r.importantDates,
        eligibility: r.eligibility, postedAt: r.postedAt, applicationDeadline: r.applicationDeadline,
      })),
    }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustVac(tenantId: string, id: string) {
    const v = await repo.findVacancy(tenantId, id);
    if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
    return v;
  }
}

export { CORRIGENDUM_ACTIONS };
