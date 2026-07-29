/**
 * Selection & offer — joining-date extension + offer analytics (R-RA-0165/0167).
 *
 *   POST /v1/hrms/offers/:offerId/joining-extension          request a later joining date
 *   POST /v1/hrms/offers/:offerId/joining-extension/approve  approve (senior) — applies the new date
 *   POST /v1/hrms/offers/:offerId/joining-extension/reject   reject (senior)
 *   GET  /v1/hrms/recruitment/offer-analytics[?jobOpeningId] funnel / acceptance / ageing / declines
 *
 * A joining-date extension is a request → approve/reject flow on an ACCEPTED offer
 * that preserves the original date. Approve/reject are senior-role actions.
 * Analytics are aggregate-only.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { offerFunnel, acceptanceRatePct, pendingAgeing, declineBreakdown, type OfferStat } from "./offer-analytics-domain.js";
import * as offerRepo from "./offer-repo.js";
import * as analyticsRepo from "./offer-analytics-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const OFFER_ADMIN_ROLES = ["hr_admin", "super_admin"];
const offerParam = z.object({ offerId: z.string().uuid() });
// Aggregate offer analytics are open to the broader HR set, but a tiny cohort
// (e.g. a job opening with one offer) makes them individually identifying — below
// this many offers the analytics need a senior role (matches the report module).
const MIN_ANALYTICS_COHORT = 5;

const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);

function isSenior(ctx: ReturnType<typeof resolveContext>): boolean {
  try { requireRole(ctx, OFFER_ADMIN_ROLES); return true; } catch { return false; }
}

export async function offerExtraRoutes(app: FastifyInstance): Promise<void> {
  // ---- joining-date extension: request (R-RA-0165) ----------------------
  app.post("/v1/hrms/offers/:offerId/joining-extension", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object({ requestedJoiningDate: z.string().date(), reason: z.string().trim().min(5).max(2000) }).parse(req.body);
    const offer = await mustOffer(ctx.tenantId, offerId);
    if (offer.status !== "accepted") throw new HttpError(409, "NOT_ACCEPTED", "a joining-date extension can only be requested on an accepted offer");
    if (offer.joiningExtensionStatus === "requested") throw new HttpError(409, "EXTENSION_PENDING", "an extension request is already pending");
    const current = offer.joiningDate;
    // A missing current joining date is a hard precondition failure — otherwise the
    // "must be later" invariant is silently skipped and any (even past) date is taken.
    if (!current) throw new HttpError(409, "NO_JOINING_DATE", "the offer has no joining date to extend");
    if (body.requestedJoiningDate <= current) throw new HttpError(422, "NOT_LATER", "the requested joining date must be later than the current one");

    await db.transaction((tx) => offerRepo.updateOffer(tx, ctx.tenantId, offerId, {
      joiningExtensionStatus: "requested",
      requestedJoiningDate: body.requestedJoiningDate,
      originalJoiningDate: offer.originalJoiningDate ?? current,
      joiningExtensionReason: body.reason,
      requestedBy: ctx.actorId, requestedAt: new Date(),   // maker recorded, survives approval
      updatedBy: ctx.actorId,
    } as never, offer.version));
    return reply.send({ offerId, joiningExtensionStatus: "requested", requestedJoiningDate: body.requestedJoiningDate });
  });

  // ---- approve (senior) -------------------------------------------------
  app.post("/v1/hrms/offers/:offerId/joining-extension/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFER_ADMIN_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const offer = await mustOffer(ctx.tenantId, offerId);
    if (offer.joiningExtensionStatus !== "requested") throw new HttpError(409, "NO_REQUEST", "there is no pending joining-date extension to approve");
    // Maker-checker: the requester cannot approve their own extension (R-RA-0165).
    if (offer.requestedBy && offer.requestedBy === ctx.actorId) throw new HttpError(403, "SOD_VIOLATION", "the requester cannot approve their own joining-date extension; an independent authorised user must approve");
    await db.transaction((tx) => offerRepo.updateOffer(tx, ctx.tenantId, offerId, {
      joiningDate: offer.requestedJoiningDate,     // apply the new date
      joiningExtensionStatus: "approved",
      joiningExtensionBy: ctx.actorId,
      joiningExtensionAt: new Date(),
      updatedBy: ctx.actorId,
    } as never, offer.version));
    return reply.send({ offerId, joiningExtensionStatus: "approved", joiningDate: offer.requestedJoiningDate });
  });

  // ---- reject (senior) --------------------------------------------------
  app.post("/v1/hrms/offers/:offerId/joining-extension/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFER_ADMIN_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const offer = await mustOffer(ctx.tenantId, offerId);
    if (offer.joiningExtensionStatus !== "requested") throw new HttpError(409, "NO_REQUEST", "there is no pending joining-date extension to reject");
    await db.transaction((tx) => offerRepo.updateOffer(tx, ctx.tenantId, offerId, {
      joiningExtensionStatus: "rejected",
      joiningExtensionBy: ctx.actorId,
      joiningExtensionAt: new Date(),
      updatedBy: ctx.actorId,
    } as never, offer.version));
    return reply.send({ offerId, joiningExtensionStatus: "rejected" });
  });

  // ---- offer analytics (R-RA-0167) --------------------------------------
  app.get("/v1/hrms/recruitment/offer-analytics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const q = z.object({ jobOpeningId: z.string().uuid().optional() }).parse(req.query);
    const rows = await analyticsRepo.listOffersForAnalytics(ctx.tenantId, q.jobOpeningId);
    // Small-cohort de-anonymisation: a job opening with a handful of offers makes
    // the "aggregate" (e.g. one decline reason) individually identifying. Restrict
    // small cohorts to senior roles.
    if (rows.length > 0 && rows.length < MIN_ANALYTICS_COHORT && !isSenior(ctx)) {
      throw new HttpError(403, "SMALL_COHORT", `offer analytics for fewer than ${MIN_ANALYTICS_COHORT} offers are restricted to senior roles to protect candidate anonymity`);
    }
    const stats: OfferStat[] = rows.map((r) => ({ status: r.status, releasedAtMs: ms(r.releasedAt), acceptedAtMs: ms(r.acceptedAt), declineReasonCode: r.declineReasonCode }));
    return reply.send({
      ...(q.jobOpeningId ? { jobOpeningId: q.jobOpeningId } : {}),
      funnel: offerFunnel(stats),
      acceptanceRatePct: acceptanceRatePct(stats),
      pendingAgeing: pendingAgeing(stats, Date.now()),
      declineBreakdown: declineBreakdown(stats),
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustOffer(tenantId: string, offerId: string) {
    const o = await offerRepo.findOffer(tenantId, offerId);
    if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
    return o;
  }
}
