import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Screening & shortlisting (checklist R-RA-0106/0110/0111/0112/0113/0114/0119).
 *
 *   POST /v1/hrms/job-openings/:id/auto-screen          rules-based auto screen (R-RA-0106)
 *   POST /v1/hrms/applications/:id/screening-decision   record a decision (R-RA-0112/0113)
 *   POST /v1/hrms/job-openings/:id/shortlist            bulk shortlist a set (R-RA-0114)
 *   POST /v1/hrms/job-openings/:id/shortlist/freeze     freeze the shortlist (R-RA-0114)
 *   GET  /v1/hrms/job-openings/:id/blind-list           blind (redacted) list (R-RA-0110)
 *   GET  /v1/hrms/applications/:id/screening-audit      screening audit trail (R-RA-0119)
 *
 * A rejection (ineligible) must carry a structured reason; re-deciding an already-
 * decided application is an override that requires an admin + an override reason;
 * once a vacancy's shortlist is frozen no further screening changes are accepted.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  SCREENING_DECISIONS, REJECTION_REASON_CODES, requiresRejectionReason,
  autoScreenDecision, redactApplicant, type ScreeningDecision,
} from "./screening.js";
import * as repo from "./screening-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
// Deliberate non-shortlist decisions that bulk shortlist must not silently
// overturn — those require the admin override path.
const BULK_SHORTLIST_BLOCKED = new Set(["ineligible", "waitlisted", "manual_review"]);
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

export async function screeningRoutes(app: FastifyInstance): Promise<void> {
  // ── rules-based auto-screen (R-RA-0106): sets eligible/ineligible from the
  //    stored eligibility_result for still-PENDING applications only (never
  //    clobbers a manual decision). ──
  app.post("/v1/hrms/job-openings/:id/auto-screen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const applications = await repo.listApplicationsForVacancy(ctx.tenantId, id);
    let screened = 0, skipped = 0;
    await publishF3Write(ctx, "recruitment_screening_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ jobOpeningId: id, screened, skipped, total: applications.length });
  });

  // ── record a screening decision (R-RA-0112/0113), with override (R-RA-0111) ──
  app.post("/v1/hrms/applications/:id/screening-decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      decision: z.enum(SCREENING_DECISIONS),
      reasonCode: z.enum(REJECTION_REASON_CODES).optional(),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);

    const a = await mustApp(ctx.tenantId, id);
    if (a.shortlistFrozen) throw new HttpError(409, "SHORTLIST_FROZEN", "the shortlist is frozen; screening can no longer be changed");
    if (requiresRejectionReason(body.decision as ScreeningDecision) && !body.reasonCode) {
      throw new HttpError(400, "REASON_REQUIRED", "a structured rejection reason is required to mark an application ineligible");
    }

    const alreadyDecided = a.screeningDecision !== "pending";
    // Idempotent re-affirmation of the same decision: a no-op. Crucially we do
    // NOT rewrite screened_by, so the original author (the SoD "content author")
    // is preserved and cannot be laundered by re-submitting the same value.
    if (alreadyDecided && a.screeningDecision === body.decision) {
      return reply.send({ id, screeningDecision: body.decision, isOverride: false, unchanged: true });
    }
    // Changing an existing decision is an OVERRIDE — it MUST go through the
    // maker-checker flow (R-RA-0111) so one admin cannot both change and approve.
    // The former single-admin direct override is deliberately closed.
    if (alreadyDecided) {
      throw new HttpError(409, "OVERRIDE_VIA_MAKER_CHECKER",
        `application is already '${a.screeningDecision}'; raise a maker-checker override at POST /v1/hrms/applications/${id}/screening-overrides`);
    }

    // First-time decision on a still-pending application.
    try {
      await publishF3Write(ctx, "recruitment_screening_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "application changed; reload and retry");
      throw err;
    }
    return reply.send({ id, screeningDecision: body.decision, isOverride: false });
  });

  // ── bulk shortlist (R-RA-0114) ──
  app.post("/v1/hrms/job-openings/:id/shortlist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ applicationIds: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
    const apps = await repo.findApplicationsByIds(ctx.tenantId, id, body.applicationIds);
    let shortlisted = 0, skipped = 0;
    await publishF3Write(ctx, "recruitment_screening_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ jobOpeningId: id, shortlisted, skipped, requested: body.applicationIds.length });
  });

  // ── freeze the shortlist (R-RA-0114): after this, no screening changes ──
  app.post("/v1/hrms/job-openings/:id/shortlist/freeze", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const all = await repo.listApplicationsForVacancy(ctx.tenantId, id);
    const shortlisted = all.filter((a) => a.screeningDecision === "shortlisted" && !a.shortlistFrozen);
    await publishF3Write(ctx, "recruitment_screening_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ jobOpeningId: id, frozen: shortlisted.length });
  });

  // ── blind list (R-RA-0110): protected attributes withheld ──
  app.get("/v1/hrms/job-openings/:id/blind-list", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const apps = await repo.listApplicationsForVacancy(ctx.tenantId, id);
    return reply.send(jsonSafe({ data: apps.map((a) => redactApplicant(a as unknown as Record<string, unknown>)) }));
  });

  // ── screening audit trail (R-RA-0119) ──
  app.get("/v1/hrms/applications/:id/screening-audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    await mustApp(ctx.tenantId, id);
    return reply.send(jsonSafe({ data: await repo.listEvents(ctx.tenantId, id) }));
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

  async function mustApp(tenantId: string, id: string) {
    const a = await repo.findApplication(tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    return a;
  }
}
