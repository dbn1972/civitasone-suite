/**
 * Selection & offer lifecycle (checklist R-RA-0155/0156/0158/0161/0163/0164).
 *
 *   POST /v1/hrms/applications/:id/offers            create a draft offer (compensation)
 *   GET  /v1/hrms/applications/:id/offers            version history
 *   GET  /v1/hrms/offers/:offerId                    read
 *   POST /v1/hrms/offers/:offerId/submit             draft -> pending_approval
 *   POST /v1/hrms/offers/:offerId/approve            advance the approval chain
 *   POST /v1/hrms/offers/:offerId/return             return for correction
 *   POST /v1/hrms/offers/:offerId/release            approved -> released
 *   POST /v1/hrms/offers/:offerId/accept             candidate accepts (metadata captured)
 *   POST /v1/hrms/offers/:offerId/decline            candidate declines (structured reason)
 *   POST /v1/hrms/offers/:offerId/withdraw           withdraw with reason
 *   POST /v1/hrms/offers/:offerId/expire             released -> expired
 *   POST /v1/hrms/offers/:offerId/revise             new version (supersedes; prev -> revised)
 *   GET  /v1/hrms/offers/:offerId/events             lifecycle audit trail
 *
 * The offer routes through an approval chain (HR → finance → legal → competent
 * authority); the offer's creator can never approve it (SoD); only a fully-
 * approved offer can be released; a decline must carry a structured reason.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  DEFAULT_OFFER_CHAIN, DECLINE_REASON_CODES, currentStageRole, isFinalStage,
  computeCompensation, canRelease, isTerminal, isOfferEditable, type ApprovalStage,
} from "./offer-domain.js";
import * as repo from "./offer-repo.js";
import type { OfferRow } from "./offer-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const KNOWN_APPROVER_ROLES = new Set(["hr_admin", "finance_officer", "legal_officer", "competent_authority", "super_admin"]);
const idParam = z.object({ id: z.string().uuid() });
const offerParam = z.object({ offerId: z.string().uuid() });

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

const compBody = {
  basicMinor: z.coerce.number().int().min(0).default(0),
  joiningBonusMinor: z.coerce.number().int().min(0).default(0),
  relocationMinor: z.coerce.number().int().min(0).default(0),
  variablePayMinor: z.coerce.number().int().min(0).default(0),
  grade: z.string().max(48).optional(),
  templateRef: z.string().max(200).optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};

function comp(body: { basicMinor: number; joiningBonusMinor: number; relocationMinor: number; variablePayMinor: number }) {
  return computeCompensation({
    basicMinor: BigInt(body.basicMinor), joiningBonusMinor: BigInt(body.joiningBonusMinor),
    relocationMinor: BigInt(body.relocationMinor), variablePayMinor: BigInt(body.variablePayMinor),
  });
}

export async function offerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/applications/:id/offers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      ...compBody,
      approvalChain: z.array(z.object({ stage: z.string().min(1).max(64), role: z.string().min(1).max(48) })).min(1).max(10).optional(),
    }).parse(req.body);
    const a = await mustApp(ctx.tenantId, id);
    // An offer is made to a selected candidate — the application must be shortlisted.
    if (a.screeningDecision !== "shortlisted") {
      throw new HttpError(409, "NOT_SHORTLISTED", "an offer can only be made to a shortlisted candidate");
    }
    const privileged = ctx.roles.some((r: string) => ADMIN_ROLES.includes(r));
    if (body.approvalChain && !privileged) throw new HttpError(403, "CHAIN_NOT_ALLOWED", "only HR admins may set a custom approval chain");
    const chain: ApprovalStage[] = body.approvalChain ?? DEFAULT_OFFER_CHAIN;
    for (const s of chain) if (!KNOWN_APPROVER_ROLES.has(s.role)) throw new HttpError(400, "INVALID_CHAIN_ROLE", `unknown approver role '${s.role}'`);

    const offerId = randomUUID();
    const nextVersion = (await repo.maxOfferVersion(ctx.tenantId, id)) + 1;
    const c = comp(body);
    try {
    await db.transaction((tx) => repo.insertOffer(tx, {
      id: offerId, tenantId: ctx.tenantId, applicationId: id,
      offerNo: `OFR-${offerId.slice(0, 8).toUpperCase()}`, offerVersion: nextVersion,
      basicMinor: c.basicMinor, joiningBonusMinor: c.joiningBonusMinor,
      relocationMinor: c.relocationMinor, variablePayMinor: c.variablePayMinor,
      grossCtcMinor: c.grossCtcMinor, ctcMinor: c.grossCtcMinor, // keep legacy ctc_minor in sync
      ...(body.grade ? { grade: body.grade } : {}),
      ...(body.templateRef ? { templateRef: body.templateRef } : {}),
      ...(body.joiningDate ? { joiningDate: body.joiningDate } : {}),
      approvalChain: chain, currentStage: -1, status: "draft",
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") throw new HttpError(409, "OFFER_VERSION_CONFLICT", "a concurrent offer was created; reload and retry");
      throw err;
    }
    return reply.code(201).send(jsonSafe({ id: offerId, offerNo: `OFR-${offerId.slice(0, 8).toUpperCase()}`, offerVersion: nextVersion, grossCtcMinor: c.grossCtcMinor, status: "draft" }));
  });

  app.get("/v1/hrms/applications/:id/offers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listOffersForApplication(ctx.tenantId, id) }));
  });

  app.get("/v1/hrms/offers/:offerId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    return reply.send(jsonSafe(await mustOffer(ctx.tenantId, offerId)));
  });

  app.get("/v1/hrms/offers/:offerId/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    await mustOffer(ctx.tenantId, offerId);
    return reply.send(jsonSafe({ data: await repo.listEvents(ctx.tenantId, offerId) }));
  });

  app.post("/v1/hrms/offers/:offerId/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const o = await mustOffer(ctx.tenantId, offerId);
    if (!isOfferEditable(o.status)) throw new HttpError(409, "WRONG_STATE", `offer is '${o.status}', cannot submit`);
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId, { status: "pending_approval", currentStage: 0 }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "submit", actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: "pending_approval", currentStage: 0 }));
  });

  app.post("/v1/hrms/offers/:offerId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object({ comments: z.string().max(2000).optional() }).parse(req.body ?? {});
    const o = await mustOffer(ctx.tenantId, offerId);
    if (o.status !== "pending_approval") throw new HttpError(409, "WRONG_STATE", `offer is '${o.status}', not pending approval`);
    const chain = o.approvalChain as ApprovalStage[];
    const role = currentStageRole(chain, o.currentStage);
    if (!role) throw new HttpError(409, "NO_STAGE", "no active approval stage");
    requireRole(ctx, [role, "super_admin"]);
    if (o.createdBy === ctx.actorId) throw new HttpError(409, "SOD_VIOLATION", "the offer creator cannot approve their own offer");
    const final = isFinalStage(chain, o.currentStage);
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId,
        final ? { status: "approved", approvedAt: new Date() } : { currentStage: o.currentStage + 1 }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "approve", remarks: body.comments ?? null, actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: final ? "approved" : "pending_approval", currentStage: final ? o.currentStage : o.currentStage + 1 }));
  });

  app.post("/v1/hrms/offers/:offerId/return", async (req, reply) => {
    const ctx = resolveContext(req);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object({ comments: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const o = await mustOffer(ctx.tenantId, offerId);
    if (o.status !== "pending_approval") throw new HttpError(409, "WRONG_STATE", `offer is '${o.status}', not pending approval`);
    const chain = o.approvalChain as ApprovalStage[];
    const role = currentStageRole(chain, o.currentStage);
    if (!role) throw new HttpError(409, "NO_STAGE", "no active approval stage");
    requireRole(ctx, [role, "super_admin"]);
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId, { status: "returned", currentStage: -1 }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "return", remarks: body.comments, actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: "returned" }));
  });

  app.post("/v1/hrms/offers/:offerId/release", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object({ expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
    const o = await mustOffer(ctx.tenantId, offerId);
    if (!canRelease(o.status)) throw new HttpError(409, "NOT_APPROVED", `offer is '${o.status}', not approved — cannot release`);
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId, { status: "released", releasedAt: new Date(), ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}) }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "release", actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: "released" }));
  });

  app.post("/v1/hrms/offers/:offerId/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object({ device: z.string().max(200).optional() }).parse(req.body ?? {});
    const o = await mustOffer(ctx.tenantId, offerId);
    if (o.status !== "released") throw new HttpError(409, "WRONG_STATE", `offer is '${o.status}', not released`);
    // R-RA-0162: capture acceptance timestamp, the accepted version, and IP/device.
    const meta = { ip: (req.headers["x-forwarded-for"] as string) ?? req.ip, userAgent: req.headers["user-agent"] ?? null, device: body.device ?? null };
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId, {
        status: "accepted", acceptedAt: new Date(), acceptedVersion: o.offerVersion, acceptanceMeta: meta as never,
      }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "accept", actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: "accepted", acceptedVersion: o.offerVersion }));
  });

  app.post("/v1/hrms/offers/:offerId/decline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object({ reasonCode: z.enum(DECLINE_REASON_CODES), remarks: z.string().max(2000).optional() }).parse(req.body);
    const o = await mustOffer(ctx.tenantId, offerId);
    if (o.status !== "released") throw new HttpError(409, "WRONG_STATE", `offer is '${o.status}', not released`);
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId, { status: "declined", declinedAt: new Date(), declineReasonCode: body.reasonCode, declineRemarks: body.remarks ?? null }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "decline", reasonCode: body.reasonCode, remarks: body.remarks ?? null, actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: "declined", reasonCode: body.reasonCode }));
  });

  app.post("/v1/hrms/offers/:offerId/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const o = await mustOffer(ctx.tenantId, offerId);
    if (isTerminal(o.status)) throw new HttpError(409, "WRONG_STATE", `offer is '${o.status}', cannot withdraw`);
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId, { status: "withdrawn", withdrawReason: body.reason }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "withdraw", remarks: body.reason, actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: "withdrawn" }));
  });

  app.post("/v1/hrms/offers/:offerId/expire", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const o = await mustOffer(ctx.tenantId, offerId);
    if (o.status !== "released") throw new HttpError(409, "WRONG_STATE", `offer is '${o.status}', not released`);
    await db.transaction(async (tx) => {
      await repo.updateOffer(tx, ctx.tenantId, offerId, { status: "expired" }, o.version);
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId, applicationId: o.applicationId, action: "expire", actorId: ctx.actorId });
    });
    return reply.send(jsonSafe({ id: offerId, status: "expired" }));
  });

  // Revise: a NEW version cloned from an existing offer; the previous becomes
  // 'revised' and the new one links back via supersedes_offer_id (R-RA-0164).
  app.post("/v1/hrms/offers/:offerId/revise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { offerId } = offerParam.parse(req.params);
    const body = z.object(compBody).partial().parse(req.body ?? {});
    const prev = await mustOffer(ctx.tenantId, offerId);
    // Revise is the re-offer / re-negotiation path — allowed from any state except
    // an already-accepted offer (a completed hire) or one already superseded.
    if (prev.status === "accepted") throw new HttpError(409, "WRONG_STATE", "an accepted offer cannot be revised");
    if (prev.status === "revised") throw new HttpError(409, "WRONG_STATE", "this offer is already superseded; revise the latest version");
    const merged = {
      basicMinor: Number(body.basicMinor ?? prev.basicMinor),
      joiningBonusMinor: Number(body.joiningBonusMinor ?? prev.joiningBonusMinor),
      relocationMinor: Number(body.relocationMinor ?? prev.relocationMinor),
      variablePayMinor: Number(body.variablePayMinor ?? prev.variablePayMinor),
    };
    const c = comp(merged);
    const newId = randomUUID();
    const nextVersion = (await repo.maxOfferVersion(ctx.tenantId, prev.applicationId)) + 1;
    try {
    await db.transaction(async (tx) => {
      // supersede the previous
      await repo.updateOffer(tx, ctx.tenantId, offerId, { status: "revised" }, prev.version);
      await repo.insertOffer(tx, {
        id: newId, tenantId: ctx.tenantId, applicationId: prev.applicationId,
        offerNo: `OFR-${newId.slice(0, 8).toUpperCase()}`, offerVersion: nextVersion,
        basicMinor: c.basicMinor, joiningBonusMinor: c.joiningBonusMinor,
        relocationMinor: c.relocationMinor, variablePayMinor: c.variablePayMinor,
        grossCtcMinor: c.grossCtcMinor, ctcMinor: c.grossCtcMinor,
        grade: (body.grade ?? prev.grade) as string | null,
        approvalChain: prev.approvalChain as never, currentStage: -1, status: "draft",
        supersedesOfferId: offerId,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await repo.insertEvent(tx, { tenantId: ctx.tenantId, offerId: newId, applicationId: prev.applicationId, action: "revise", remarks: `supersedes ${prev.offerNo ?? offerId}`, actorId: ctx.actorId });
    });
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") throw new HttpError(409, "OFFER_VERSION_CONFLICT", "a concurrent revision was created; reload and retry");
      throw err;
    }
    return reply.code(201).send(jsonSafe({ id: newId, offerVersion: nextVersion, supersedesOfferId: offerId, grossCtcMinor: c.grossCtcMinor, status: "draft" }));
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
  async function mustOffer(tenantId: string, id: string): Promise<OfferRow> {
    const o = await repo.findOffer(tenantId, id);
    if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
    return o;
  }
}
