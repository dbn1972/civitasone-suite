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
  autoScreenDecision, redactApplicant, stageForScreeningDecision, type ScreeningDecision,
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
    // Was a literal `let screened = 0, skipped = 0;` that never got
    // incremented — the actual classification loop only ran inside the async
    // consumer (recruitment_screening_routes__0), which the route never saw
    // the result of (fire-and-forget). This is genuinely computable
    // synchronously: `applications` is the exact same list the consumer reads
    // (repo.listApplicationsForVacancy), and this loop mirrors the consumer's
    // classification EXACTLY (same `screeningDecision !== "pending"` check,
    // same autoScreenDecision() call — the single shared pure function in
    // screening.ts) without performing any writes; the consumer still does
    // the actual writes independently. Residual risk: if an application's
    // screeningDecision changes between this read and the consumer's
    // independent read (a genuine concurrent decision on the same
    // application), the counts reported here could diverge from what the
    // consumer actually applies — same class of TOCTOU residual risk
    // documented elsewhere in this PR, not a new one.
    let screened = 0, skipped = 0;
    for (const a of applications) {
      if (a.screeningDecision !== "pending") { skipped++; continue; }
      const decision = autoScreenDecision(a.eligibilityResult as { eligible?: boolean } | null);
      if (decision === "pending") { skipped++; continue; }
      screened++;
    }
    await publishF3Write(ctx, "recruitment_screening_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ jobOpeningId: id, screened, skipped, total: applications.length }) as any;
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

    // Leaves an audit trail (R-RA-0119) for a denied re-decision, then rejects
    // it towards the real maker-checker override flow (R-RA-0111): a second
    // decision on an already-decided application must never be silently
    // applied -- and must never vanish without a trace either.
    //
    // This db.transaction call is pinned in the KNOWN_INTENTIONAL_SYNC_WRITES
    // allowlist in tests/f3-leftover-hrms-cqrs.test.ts
    // (fix/hrms-screening-toctou) -- it is a deliberate exception to that
    // guard test's sync-write scan, not an accidental F3 leftover. Do not
    // "fix" it back to an async publishF3Write: the 409 this throws must be
    // backed by an audit event that has ALREADY landed by the time the
    // caller sees it, not one a queue consumer might write later (or never).
    async function denyAsOverride(jobOpeningId: string, currentDecision: string): Promise<never> {
      await db.transaction((tx) => repo.insertEvent(tx, {
        tenantId: ctx.tenantId, applicationId: id, jobOpeningId,
        action: "override_denied", decision: body.decision,
        reasonCode: body.reasonCode ?? null, remarks: body.remarks ?? null,
        isOverride: false, actorId: ctx.actorId,
      }));
      throw new HttpError(409, "OVERRIDE_VIA_MAKER_CHECKER",
        `application is already '${currentDecision}'; raise a maker-checker override at POST /v1/hrms/applications/${id}/screening-overrides`);
    }

    // Fast path only, NOT the concurrency guard -- a slow/sequential second
    // request that reads here after the first has already committed is caught
    // right now, without paying for a write transaction. But two requests
    // racing Promise.all-style both pass this check having each read 'pending'
    // before either write lands; the real guard is the atomic conditional
    // UPDATE below, keyed on the DB row still being 'pending' at write time,
    // not on this read (R-RA-0111).
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
      return denyAsOverride(a.jobOpeningId, a.screeningDecision);
    }

    // First-time decision on a still-pending application (R-RA-0111). Recorded
    // SYNCHRONOUSLY -- not via the fire-and-forget F3 queue (see
    // f3-consumer.ts's now-superseded "recruitment_screening_routes__1" case)
    // -- because the maker-checker guarantee is an HTTP-visible contract: the
    // caller must learn RIGHT NOW whether theirs was the first decision, not
    // from a later log line. The write is a single UPDATE conditioned on the
    // row STILL being 'pending' (in the same statement that records the
    // decision), so two genuinely concurrent requests race the SQL statement
    // itself: Postgres's row lock serialises them, and whichever commits
    // second re-evaluates its WHERE clause against the now-changed row and
    // affects zero rows -- closing the TOCTOU window a plain read-then-write
    // (or a version-only guard, which never inspects screening_decision)
    // leaves open.
    //
    // This db.transaction call (and the repo.insertEvent inside it) is
    // pinned in the KNOWN_INTENTIONAL_SYNC_WRITES allowlist in
    // tests/f3-leftover-hrms-cqrs.test.ts (fix/hrms-screening-toctou) -- a
    // deliberate exception to that guard test's sync-write scan, not an
    // accidental F3 leftover. Do not "fix" it back to an async
    // publishF3Write; that would reopen the exact race
    // screening-decision-race.test.ts proves closed.
    const stagePatch = stageForScreeningDecision(body.decision as ScreeningDecision);
    const patch = {
      screeningDecision: body.decision,
      screeningReasonCode: body.reasonCode ?? null,
      screeningRemarks: body.remarks ?? null,
      screenedBy: ctx.actorId, screenedAt: new Date(),
      ...(stagePatch ? { stage: stagePatch } : {}),
    };
    const won = await db.transaction(async (tx) => {
      const applied = await repo.setScreeningIfPending(tx, ctx.tenantId, id, patch, a.version);
      if (applied) {
        await repo.insertEvent(tx, {
          tenantId: ctx.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
          action: "decision", decision: body.decision,
          reasonCode: body.reasonCode ?? null, remarks: body.remarks ?? null,
          isOverride: false, actorId: ctx.actorId,
        });
      }
      return applied;
    });
    if (won) {
      return reply.send({ id, screeningDecision: body.decision, isOverride: false });
    }

    // Lost the race: another request's decision landed first, between our
    // read above and our UPDATE. Re-read to classify exactly like the fast
    // path above would have, and handle it exactly the same way.
    const fresh = await mustApp(ctx.tenantId, id);
    if (fresh.screeningDecision === body.decision) {
      return reply.send({ id, screeningDecision: body.decision, isOverride: false, unchanged: true });
    }
    if (fresh.screeningDecision !== "pending") {
      return denyAsOverride(fresh.jobOpeningId, fresh.screeningDecision);
    }
    // Still 'pending': the lost race was a version bump from something else
    // entirely (e.g. a concurrent edit to another field on the application),
    // not a screening decision -- the pre-existing, unrelated conflict case.
    throw new HttpError(409, "VERSION_CONFLICT", "application changed; reload and retry");
  });

  // ── bulk shortlist (R-RA-0114) ──
  app.post("/v1/hrms/job-openings/:id/shortlist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ applicationIds: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
    const apps = await repo.findApplicationsByIds(ctx.tenantId, id, body.applicationIds);
    // Was a literal `let shortlisted = 0, skipped = 0;` that never got
    // incremented — same placeholder-counter bug as auto-screen above.
    // Genuinely computable synchronously: `apps` is the exact same set the
    // consumer reads (repo.findApplicationsByIds), and this loop mirrors the
    // consumer's classification EXACTLY (frozen -> skip, then
    // BULK_SHORTLIST_BLOCKED membership -> skip, else shortlist) without
    // performing any writes. BULK_SHORTLIST_BLOCKED is duplicated verbatim
    // here and in f3-consumer.ts (pre-existing pattern in this file, not
    // introduced by this fix) rather than imported from one place — if that
    // set is ever edited, it must be edited in both places or the route's
    // reported counts and the consumer's actual writes will silently
    // diverge. Same residual TOCTOU risk as auto-screen above (an
    // application's decision changing between this read and the consumer's
    // independent read).
    let shortlisted = 0, skipped = 0;
    for (const a of apps) {
      if (a.shortlistFrozen) { skipped++; continue; }
      if (BULK_SHORTLIST_BLOCKED.has(a.screeningDecision)) { skipped++; continue; }
      shortlisted++;
    }
    await publishF3Write(ctx, "recruitment_screening_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ jobOpeningId: id, shortlisted, skipped, requested: body.applicationIds.length }) as any;
  });

  // ── freeze the shortlist (R-RA-0114): after this, no screening changes ──
  app.post("/v1/hrms/job-openings/:id/shortlist/freeze", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const all = await repo.listApplicationsForVacancy(ctx.tenantId, id);
    const shortlisted = all.filter((a) => a.screeningDecision === "shortlisted" && !a.shortlistFrozen);
    await publishF3Write(ctx, "recruitment_screening_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ jobOpeningId: id, frozen: shortlisted.length }) as any;
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
