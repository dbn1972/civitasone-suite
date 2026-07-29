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
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { REJECTION_REASON_CODES, SCREENING_DECISIONS } from "./screening.js";
import { validateOverrideRequest, sodViolationForApprover, isActionable } from "./screening-override.js";
import * as repo from "./screening-override-repo.js";
import * as screeningRepo from "./screening-repo.js";

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
      await db.transaction((tx) => repo.createRequest(tx, {
        id: rid, tenantId: ctx.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
        fromDecision: a.screeningDecision, toDecision: body.toDecision,
        applicationVersion: a.version,
        reasonCode: body.reasonCode ?? null, reason: body.reason,
        status: "pending", originalScreenedBy: a.screenedBy ?? null,
        requestedBy: ctx.actorId,
      }));
    } catch (err) {
      // partial unique index (one pending per application) — concurrent request
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "OVERRIDE_PENDING", "an override request is already pending for this application");
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
    if (!isActionable(r.status)) throw new HttpError(409, "NOT_PENDING", `override request is '${r.status}', not pending`);

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
    // version, and is correctly caught here as stale.
    if (a.screeningDecision !== r.fromDecision || a.version !== r.applicationVersion) {
      throw new HttpError(409, "STALE_OVERRIDE", `the application changed since the override was raised (now '${a.screeningDecision}' v${a.version}, raised against '${r.fromDecision}' v${r.applicationVersion}); re-raise it`);
    }

    try {
      await db.transaction(async (tx) => {
        await screeningRepo.setScreening(tx, ctx.tenantId, r.applicationId, {
          screeningDecision: r.toDecision,
          screeningReasonCode: r.reasonCode ?? null,
          screeningRemarks: r.reason,
          screenedBy: ctx.actorId, screenedAt: new Date(),
        }, a.version);
        await screeningRepo.insertEvent(tx, {
          tenantId: ctx.tenantId, applicationId: r.applicationId, jobOpeningId: r.jobOpeningId,
          action: "override", decision: r.toDecision, reasonCode: r.reasonCode ?? null,
          remarks: r.reason, isOverride: true, actorId: ctx.actorId,
        });
        await repo.setRequestStatus(tx, ctx.tenantId, reqId, {
          status: "approved", decidedBy: ctx.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
        }, r.version);
      });
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "the application or request changed; reload and retry");
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
    if (!isActionable(r.status)) throw new HttpError(409, "NOT_PENDING", `override request is '${r.status}', not pending`);
    // A checker other than the requester must reject (no self-approval loop).
    if (ctx.actorId === r.requestedBy) throw new HttpError(403, "SOD_VIOLATION", "separation of duties: the requester cannot decide their own override");

    try {
      await db.transaction((tx) => repo.setRequestStatus(tx, ctx.tenantId, reqId, {
        status: "rejected", decidedBy: ctx.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
      }, r.version));
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "the request changed; reload and retry");
      throw err;
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
      await db.transaction((tx) => repo.setRequestStatus(tx, ctx.tenantId, reqId, {
        status: "cancelled", decidedBy: ctx.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
      }, r.version));
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
}
