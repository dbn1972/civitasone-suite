import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canRenew } from "./domain.js";
import * as applicationsRepo from "../applications/repo.js";

const ADV_ROLES = ["adv_user", "adv_admin", "super_admin"];
const OFFICER_ROLES = ["adv_admin", "adv_officer", "super_admin"];

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const issueBody = z.object({
  applicationId: z.string().uuid(),
  validFrom: z.string().date(),
  validUntil: z.string().date(),
  location: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    address: z.string().min(1),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  advertisementType: z.enum(["hoarding", "banner", "signage", "kiosk", "digital"]),
});

const renewBody = z.object({
  renewalType: z.enum(["renewal", "creative_change", "size_change", "location_change", "removal"]),
  newValidUntil: z.string().date(),
  // BUG FIX (money field): was a bare z.string() with no format check, so
  // any non-numeric string passed route validation, got 202-accepted, and
  // only threw when permits/consumer.ts's `BigInt(p.feeMinor)` ran INSIDE
  // the write transaction — a silent failure from the caller's perspective
  // (the transaction rolled back with no way for the citizen/officer to
  // know). zMoneyMinorStringNonNeg is the canonical @civitasone/schemas
  // money codec (same fix applied to revenue-service's arrears/shared
  // validators earlier tonight, PR #985): accepts string | safe-integer
  // number, rejects anything else — including negative and unsafe-integer
  // values — with a normal 400 at the route, before 202. Normalizes to a
  // base-10 string, so the downstream BigInt(p.feeMinor) call site in
  // consumer.ts is unaffected.
  feeMinor: zMoneyMinorStringNonNeg,
});

const actionBody = z.object({ reason: z.string().min(1).max(1000) });
const verifyQuery = z.object({ code: z.string().min(1).max(64) });

export async function permitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/advertisement/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/advertisement/permits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = cache.makeKey(ctx.tenantId, "permit", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    return reply.send({ data: row });
  });

  app.get("/v1/advertisement/permits/verify", async (req, reply) => {
    const q = verifyQuery.parse(req.query);
    const permit = await repo.findByVerificationCode(q.code);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "No permit found for this verification code");
    return reply.send({
      data: {
        permitNumber: permit.permitNumber,
        advertisementType: permit.advertisementType,
        status: permit.status,
        issuedAt: permit.issuedAt,
        validFrom: permit.validFrom,
        validUntil: permit.validUntil,
      },
    });
  });

  app.post("/v1/advertisement/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = issueBody.parse(req.body);

    // BUG FIX (pre-accept validation): nothing previously checked that
    // body.applicationId referred to a real, approved application before
    // publishing issuePermit — a permit could be issued against a random
    // non-existent UUID, or against a "draft"/"submitted"/"rejected"
    // application, identically to an "approved" one. Mirrors
    // roadcut-service's permits/routes.ts POST /v1/roadcut/permits, the
    // fleet's established reference pattern for this exact check.
    const application = await applicationsRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) {
      throw new HttpError(404, "APPLICATION_NOT_FOUND", "Referenced application not found");
    }
    if (application.status !== "approved") {
      throw new HttpError(
        422,
        "APPLICATION_NOT_APPROVED",
        `Cannot issue a permit for application in status '${application.status}'; it must be 'approved'`,
      );
    }
    const existingPermit = await repo.findByApplication(body.applicationId, ctx.tenantId);
    if (existingPermit) {
      throw new HttpError(409, "PERMIT_ALREADY_EXISTS", "A permit has already been issued for this application");
    }
    if (new Date(body.validUntil).getTime() <= new Date(body.validFrom).getTime()) {
      throw new HttpError(422, "INVALID_DATE_RANGE", "validUntil must be after validFrom");
    }

    return reply.code(202).send(
      await commands.issuePermit(ctx, body.applicationId, body.validFrom, body.validUntil, body.location, body.advertisementType),
    );
  });

  app.post("/v1/advertisement/permits/:id/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const { id } = idParam.parse(req.params);
    const body = renewBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    // BUG FIX (pre-accept validation): existence was already checked, but
    // there was no state gate at all — a cancelled or expired permit could
    // be "renewed" the same as an active one. See permits/domain.ts's
    // canRenew.
    if (!canRenew(permit.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot renew permit in status '${permit.status}'`);
    }
    if (new Date(body.newValidUntil).getTime() <= new Date().getTime()) {
      throw new HttpError(422, "INVALID_DATE_RANGE", "newValidUntil must be in the future");
    }
    return reply.code(202).send(await commands.renewPermit(ctx, id, body.renewalType, body.newValidUntil, body.feeMinor));
  });

  app.post("/v1/advertisement/permits/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!["issued", "active"].includes(permit.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot suspend permit in status '${permit.status}'`);
    }
    return reply.code(202).send(await commands.suspendPermit(ctx, id, body.reason));
  });

  app.post("/v1/advertisement/permits/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (permit.status === "cancelled") {
      throw new HttpError(422, "INVALID_STATUS", "Permit already cancelled");
    }
    return reply.code(202).send(await commands.cancelPermit(ctx, id, body.reason));
  });
}
