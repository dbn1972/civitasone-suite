import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Maker-checker override of a screening decision (R-RA-0111).
 *
 *   POST /v1/hrms/applications/:id/screening-overrides        request an override (maker)
 *   POST /v1/hrms/screening-overrides/:reqId/approve          approve + apply (checker)
 *   POST /v1/hrms/screening-overrides/:reqId/reject           reject (checker)
 *   GET  /v1/hrms/applications/:id/screening-overrides        list requests for an application
 *
 * The requester and the approver must be different officers (separation of
 * duties); the approver may also not be the officer who authored the decision
 * being overturned. Only on approval is the application's screening decision
 * actually changed — and it is applied under an optimistic-version guard so a
 * decision that moved on since the request was raised is rejected as stale.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { REJECTION_REASON_CODES, SCREENING_DECISIONS } from "./screening.js";
import { validateOverrideRequest, sodViolationForApprover, isActionable } from "./screening-override.js";
import { emitAudit } from "./audit-emit.js";
import * as repo from "./screening-override-repo.js";
import * as screeningRepo from "./screening-repo.js";
import type { ScreeningOverrideRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const reqParam = z.object({ reqId: z.string().uuid() });

export async function screeningOverrideRoutes(app: FastifyInstance): Promise<void> {
  // ── request an override (maker) ──
  app.post("/v1/hrms/applications/:id/screening-overrides", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      toDecision: z.enum(SCREENING_DECISIONS),
      reasonCode: z.enum(REJECTION_REASON_CODES).optional(),
      reason: z.string().min(1).max(2000),
    }).parse(req.body);

    const a = await mustApp(ctx.tenantId, id);
    if (a.shortlistFrozen) throw new HttpError(409, "SHORTLIST_FROZEN", "the shortlist is frozen; screening can no longer be changed");

    const errors = validateOverrideRequest({ fromDecision: a.screeningDecision, toDecision: body.toDecision, reasonCode: body.reasonCode, reason: body.reason });
    if (errors.length > 0) throw new HttpError(422, "INVALID_OVERRIDE", errors.join("; "));

    const existing = await repo.findPendingForApplication(ctx.tenantId, id);
    if (existing) throw new HttpError(409, "OVERRIDE_PENDING", "an override request is already pending for this application");

    const rid = randomUUID();
    try {
      await publishF3Write(ctx, "recruitment_screening_override_routes__0", rid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      // partial unique index (one pending per application) — concurrent request
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "OVERRIDE_PENDING", "an override request is already pending for this application") as any;
      }
      throw err;
    }
    return reply.code(201).send({ id: rid, applicationId: id, status: "pending", fromDecision: a.screeningDecision, toDecision: body.toDecision });
  });

  // ── approve + apply (checker) ──
  app.post("/v1/hrms/screening-overrides/:reqId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { reqId } = reqParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});

    const r = await mustReq(ctx.tenantId, reqId);
    // This fast-path denial is reached whenever THIS request's own read
    // happens after the other racer's write already committed -- which, under
    // genuine concurrency, is common (there is no guarantee both racers' reads
    // land before either write does; that's only the WORST case, not the only
    // one). It is exactly as much a "lost the race" outcome as the atomic
    // conditional UPDATE losing below, so it must be audited identically --
    // mirroring PR #1585's denyAsOverride, which routes its own analogous
    // fast-path "alreadyDecided" check through the SAME audited helper as its
    // atomic-race-loss path, for the same reason.
    if (!isActionable(r.status)) {
      await recordOverrideDecisionDenied(ctx, r, "approve", "NOT_PENDING");
      throw new HttpError(409, "NOT_PENDING", `override request is '${r.status}', not pending`);
    }

    const a = await screeningRepo.findApplication(ctx.tenantId, r.applicationId);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    if (a.shortlistFrozen) throw new HttpError(409, "SHORTLIST_FROZEN", "the shortlist is frozen; screening can no longer be changed");

    // SoD is checked against BOTH the author recorded at request time and the
    // CURRENT author of the decision (guards against the author changing between
    // request and approval). Approver must be neither, nor the requester.
    const sod = sodViolationForApprover(ctx.actorId, { requestedBy: r.requestedBy, originalScreenedBy: r.originalScreenedBy })
      ?? sodViolationForApprover(ctx.actorId, { requestedBy: r.requestedBy, originalScreenedBy: a.screenedBy });
    if (sod) throw new HttpError(403, "SOD_VIOLATION", sod);

    // The decision AND the exact application version must match what the override
    // was raised against; an A→B→A cycle produces the same value but a new
    // version, and is correctly caught here as stale. Fast path only, NOT the
    // concurrency guard -- a slow/sequential second request that reads here
    // after the first already committed is caught right now, without paying
    // for a write transaction. But two requests racing Promise.all-style (two
    // approvals, or an approve racing a reject) both pass every check above
    // having each read the SAME pending/current state before either write
    // lands; the real guard is the atomic conditional UPDATEs below, keyed on
    // the DB rows still matching at write time, not on these reads (R-RA-0111).
    // Same audit obligation as the isActionable check above: this fast path is
    // reached just as often under real racing as the atomic path below, so it
    // must leave the identical trace.
    if (a.screeningDecision !== r.fromDecision || a.version !== r.applicationVersion) {
      await recordOverrideDecisionDenied(ctx, r, "approve", "STALE_OVERRIDE");
      throw new HttpError(409, "STALE_OVERRIDE", `the application changed since the override was raised (now '${a.screeningDecision}' v${a.version}, raised against '${r.fromDecision}' v${r.applicationVersion}); re-raise it`);
    }

    // R-RA-0111: recorded SYNCHRONOUSLY and atomically -- not via the
    // fire-and-forget F3 queue (see f3-consumer.ts's now-superseded
    // "recruitment_screening_override_routes__1" case, which re-fetched fresh
    // rows but never re-checked isActionable/SoD/staleness before writing,
    // relying entirely on the checks above even though by the time it ran they
    // could be long stale) -- because the maker-checker guarantee is an
    // HTTP-visible contract: the caller must learn RIGHT NOW whether theirs
    // was the winning decision, not from a later log line. Both writes below
    // are single UPDATEs conditioned on the rows STILL matching (in the same
    // transaction that records the decision), so two genuinely concurrent
    // requests race the SQL statements themselves: Postgres's row locks
    // serialise them, and whichever commits second re-evaluates its WHERE
    // clause against the now-changed row and affects zero rows -- closing the
    // TOCTOU window the checks above (a plain read-then-write) leave open.
    //
    // This db.transaction call (and the repo.insertEvent inside it) is pinned
    // in the KNOWN_INTENTIONAL_SYNC_WRITES allowlist in
    // tests/f3-leftover-hrms-cqrs.test.ts (fix/hrms-screening-override-toctou)
    // -- a deliberate exception to that guard test's sync-write scan, not an
    // accidental F3 leftover. Do not "fix" it back to an async
    // publishF3Write: that would reopen the exact race
    // screening-override-decision-race.test.ts proves closed.
    const decidedAt = new Date();
    try {
      await db.transaction(async (tx) => {
        const reqWon = await repo.setRequestStatusIfPending(tx, ctx.tenantId, reqId, {
          status: "approved", decidedBy: ctx.actorId, decidedAt, decisionNote: body.note ?? null,
        }, r.version);
        if (!reqWon) throw new Error("OVERRIDE_NOT_PENDING");

        // Both sides win together or not at all: if the application moved on
        // since the override was raised, this throws VERSION_CONFLICT and
        // rolls back the request-status change above too -- never a request
        // marked "approved" whose application was never actually changed.
        try {
          await screeningRepo.setScreening(tx, ctx.tenantId, r.applicationId, {
            screeningDecision: r.toDecision,
            screeningReasonCode: r.reasonCode ?? null,
            screeningRemarks: r.reason,
            screenedBy: ctx.actorId, screenedAt: decidedAt,
          }, r.applicationVersion);
        } catch (err) {
          if ((err as Error).message === "VERSION_CONFLICT") throw new Error("OVERRIDE_STALE");
          throw err;
        }

        await screeningRepo.insertEvent(tx, {
          tenantId: ctx.tenantId, applicationId: r.applicationId, jobOpeningId: r.jobOpeningId,
          action: "override", decision: r.toDecision, reasonCode: r.reasonCode ?? null,
          remarks: r.reason, isOverride: true, actorId: ctx.actorId,
        });
        await emitAudit(tx, toAuditCtx(ctx), "screening_override_approved", "screening_override", reqId, {
          applicationId: r.applicationId, fromDecision: r.fromDecision, toDecision: r.toDecision, requestedBy: r.requestedBy,
        });
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "OVERRIDE_NOT_PENDING" || msg === "OVERRIDE_STALE") {
        await recordOverrideDecisionDenied(ctx, r, "approve", msg === "OVERRIDE_STALE" ? "STALE_OVERRIDE" : "NOT_PENDING");
        throw msg === "OVERRIDE_STALE"
          ? new HttpError(409, "STALE_OVERRIDE", "the application changed since the override was raised; re-raise it")
          : new HttpError(409, "NOT_PENDING", "override request is no longer pending");
      }
      throw err;
    }
    return reply.send({ id: reqId, applicationId: r.applicationId, status: "approved", screeningDecision: r.toDecision });
  });

  // ── reject (checker) ──
  app.post("/v1/hrms/screening-overrides/:reqId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { reqId } = reqParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});

    const r = await mustReq(ctx.tenantId, reqId);
    // Same audit obligation as /approve's identical fast-path check above: under
    // genuine racing, this is reached just as often as the atomic path below
    // (whenever this request's own read happens after the other racer's write
    // already committed), so it must leave the identical trace.
    if (!isActionable(r.status)) {
      await recordOverrideDecisionDenied(ctx, r, "reject", "NOT_PENDING");
      throw new HttpError(409, "NOT_PENDING", `override request is '${r.status}', not pending`);
    }
    // A checker other than the requester must reject (no self-approval loop).
    if (ctx.actorId === r.requestedBy) throw new HttpError(403, "SOD_VIOLATION", "separation of duties: the requester cannot decide their own override");

    // R-RA-0111: synchronous + atomic for the identical reason as /approve
    // above -- a checker decision racing another checker decision on the SAME
    // request (e.g. one admin approves while another rejects, both reading
    // 'pending' before either write lands) must not both silently "succeed".
    // See the comment on /approve's db.transaction for the full write-up.
    //
    // This db.transaction call is pinned in the KNOWN_INTENTIONAL_SYNC_WRITES
    // allowlist in tests/f3-leftover-hrms-cqrs.test.ts
    // (fix/hrms-screening-override-toctou) -- do not "fix" it back to an async
    // publishF3Write.
    const won = await db.transaction((tx) => repo.setRequestStatusIfPending(tx, ctx.tenantId, reqId, {
      status: "rejected", decidedBy: ctx.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
    }, r.version));
    if (!won) {
      await recordOverrideDecisionDenied(ctx, r, "reject", "NOT_PENDING");
      throw new HttpError(409, "NOT_PENDING", "override request is no longer pending");
    }
    return reply.send({ id: reqId, status: "rejected" });
  });

  // ── cancel (requester withdraws their own pending request) ──
  // Frees the "one pending per application" slot so a fresh request can be raised.
  app.post("/v1/hrms/screening-overrides/:reqId/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { reqId } = reqParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});

    const r = await mustReq(ctx.tenantId, reqId);
    if (!isActionable(r.status)) throw new HttpError(409, "NOT_PENDING", `override request is '${r.status}', not pending`);
    // Only the requester (or a super_admin) may cancel a pending request.
    if (ctx.actorId !== r.requestedBy && !ctx.roles.includes("super_admin")) {
      throw new HttpError(403, "NOT_REQUESTER", "only the officer who raised the override (or a super_admin) may cancel it");
    }
    try {
      await publishF3Write(ctx, "recruitment_screening_override_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "the request changed; reload and retry");
      throw err;
    }
    return reply.send({ id: reqId, status: "cancelled" });
  });

  // ── list override requests for an application (any HR reader) ──
  app.get("/v1/hrms/applications/:id/screening-overrides", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    await mustApp(ctx.tenantId, id);
    return reply.send({ id, data: await repo.listForApplication(ctx.tenantId, id) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustApp(tenantId: string, id: string) {
    const a = await screeningRepo.findApplication(tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    return a;
  }
  async function mustReq(tenantId: string, id: string) {
    const r = await repo.findRequest(tenantId, id);
    if (!r) throw new HttpError(404, "NOT_FOUND", "override request not found");
    return r;
  }

  function toAuditCtx(ctx: RequestContext) {
    return { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId };
  }

  // Leaves a trace (R-RA-0111) that a checker decision on this override was
  // denied -- either because someone else already decided the request, or the
  // application it targets moved on since it was raised -- whether caught by
  // the route's own sequential pre-check or by losing the atomic race above. A
  // denied checker decision must never vanish without a trace any more than an
  // applied one does (the exact "zero-trace override" gap PR #1585 closed for
  // the screening-decision endpoint).
  //
  // Reuses hrms_screening_events' existing 'override_denied' action (added by
  // PR #1585's migration 0152 -- no new migration needed) with isOverride:true
  // to distinguish it from that PR's own usage (isOverride:false, a direct
  // redecision redirected into the override flow): both represent "a change to
  // this application's screening outcome was denied", just from different
  // endpoints. Also emits the generic audit-event outbox record used elsewhere
  // in this file, so a denied checker decision shows up on that stream too,
  // not only on the application's own screening-events timeline.
  //
  // This db.transaction call (and the repo.insertEvent inside it) is pinned in
  // the KNOWN_INTENTIONAL_SYNC_WRITES allowlist in
  // tests/f3-leftover-hrms-cqrs.test.ts (fix/hrms-screening-override-toctou).
  async function recordOverrideDecisionDenied(
    ctx: RequestContext, r: ScreeningOverrideRow, attempted: "approve" | "reject", reason: "NOT_PENDING" | "STALE_OVERRIDE",
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await screeningRepo.insertEvent(tx, {
        tenantId: ctx.tenantId, applicationId: r.applicationId, jobOpeningId: r.jobOpeningId,
        action: "override_denied", decision: r.toDecision, reasonCode: r.reasonCode ?? null,
        remarks: r.reason, isOverride: true, actorId: ctx.actorId,
      });
      await emitAudit(tx, toAuditCtx(ctx), "screening_override_decision_denied", "screening_override", r.id, {
        applicationId: r.applicationId, attempted, reason,
      });
    });
  }
}
