import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as appRepo from "../applications/repo.js";
import * as inspectionsRepo from "../inspections/repo.js";
import * as commands from "./commands.js";
import { checkNocEligibility } from "./domain.js";

const FIRE_ROLES = ["fire_user", "fire_admin", "super_admin"];
const OFFICER_ROLES = ["fire_admin", "fire_officer", "super_admin"];

const listQuery = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const issueBody = z.object({
  applicationId: z.string().uuid(),
  validFrom: z.string().date(),
  conditions: z.record(z.unknown()).optional(),
  durationYears: z.number().int().positive().max(10).optional(),
});

const actionBody = z.object({ reason: z.string().min(1).max(1000) });
const verifyQuery = z.object({ code: z.string().min(1).max(64) });

export async function nocRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/fire/nocs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { total, limit: q.limit ?? 25, offset: q.offset ?? 0 } });
  });

  app.get("/v1/fire/nocs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `fire:${ctx.tenantId}:noc:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(ctx.tenantId, id));
    if (!row) throw new HttpError(404, "NOC_NOT_FOUND", "NOC not found");
    return reply.send({ data: row });
  });

  app.get("/v1/fire/nocs/verify", async (req, reply) => {
    const q = verifyQuery.parse(req.query);
    const noc = await repo.findByVerificationCode(q.code);
    if (!noc) throw new HttpError(404, "NOC_NOT_FOUND", "No NOC found for this verification code");
    return reply.send({
      data: {
        nocNumber: noc.nocNumber,
        status: noc.status,
        issuedAt: noc.issuedAt,
        validFrom: noc.validFrom,
        validUntil: noc.validUntil,
      },
    });
  });

  app.post("/v1/fire/nocs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = issueBody.parse(req.body);
    // CRITICAL fix: previously issued unconditionally — see domain.ts's
    // checkNocEligibility for the full reasoning. The consumer re-checks this
    // atomically with the actual write.
    const application = await appRepo.findById(ctx.tenantId, body.applicationId);
    const inspections = application ? await inspectionsRepo.findByApplicationId(ctx.tenantId, body.applicationId) : [];
    const eligibility = checkNocEligibility(application, inspections);
    if (!eligibility.eligible) {
      throw new HttpError(422, "NOT_ELIGIBLE_FOR_NOC", eligibility.reason);
    }
    const existingActive = await repo.findActiveByApplicationId(ctx.tenantId, body.applicationId);
    if (existingActive) {
      throw new HttpError(409, "NOC_ALREADY_ACTIVE", `Application already has an active NOC (${existingActive.nocNumber})`);
    }
    return reply.code(202).send(await commands.issueNoc(ctx, body));
  });

  app.post("/v1/fire/nocs/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const noc = await repo.findById(ctx.tenantId, id);
    if (!noc) throw new HttpError(404, "NOC_NOT_FOUND", "NOC not found");
    if (!["issued", "active"].includes(noc.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot suspend NOC in status '${noc.status}'`);
    }
    return reply.code(202).send(await commands.suspendNoc(ctx, id, body));
  });

  app.post("/v1/fire/nocs/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const noc = await repo.findById(ctx.tenantId, id);
    if (!noc) throw new HttpError(404, "NOC_NOT_FOUND", "NOC not found");
    if (noc.status === "revoked") {
      throw new HttpError(422, "INVALID_STATUS", "NOC already revoked");
    }
    return reply.code(202).send(await commands.revokeNoc(ctx, id, body));
  });
}
