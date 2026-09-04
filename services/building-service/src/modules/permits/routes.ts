import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canPerformAction } from "./domain.js";
import * as applicationsRepo from "../applications/repo.js";

const BUILDING_ROLES = ["building_user", "building_admin", "super_admin"];
const OFFICER_ROLES = ["building_admin", "building_officer", "super_admin"];

const listQuery = z.object({ status: z.string().optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(100).optional() });
const idParam = z.object({ id: z.string().uuid() });
const issueBody = z.object({ applicationId: z.string().uuid(), conditions: z.array(z.object({ condition: z.string(), category: z.string() })).optional(), validityMonths: z.number().int().positive().max(120).optional() });
const actionBody = z.object({ reason: z.string().min(1).max(1000) });
const verifyQuery = z.object({ code: z.string().min(1).max(64) });

export async function permitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/building/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/building/permits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = cache.makeKey(ctx.tenantId, "permit", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    return reply.send({ data: row });
  });

  app.get("/v1/building/permits/verify", async (req, reply) => {
    const q = verifyQuery.parse(req.query);
    const permit = await repo.findByVerificationCode(q.code);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "No permit found for this verification code");
    return reply.send({ data: { permitNumber: permit.permitNumber, status: permit.status, issuedAt: permit.issuedAt, validUntil: permit.validUntil } });
  });

  app.post("/v1/building/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = issueBody.parse(req.body);

    // A permit is a legal document issued against a specific, approved
    // application. Previously nothing checked the application even existed,
    // that it was in an 'approved' state, or pre-empted the
    // building_permits_application_id_key unique index added in PR #1001 — a
    // duplicate issue attempt (retry, double-click, concurrent request)
    // surfaced as a raw, unhandled DB constraint violation (500) instead of a
    // clean 409. Mirrors roadcut-service/src/modules/permits/routes.ts
    // (existence -> state -> duplicate, all derived server-side).
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
    const existingPermit = await repo.findByApplicationId(body.applicationId, ctx.tenantId);
    if (existingPermit) {
      throw new HttpError(409, "PERMIT_ALREADY_EXISTS", "A permit has already been issued for this application");
    }

    return reply.code(202).send(await commands.issuePermit(ctx, body.applicationId, body.conditions, body.validityMonths));
  });

  app.post("/v1/building/permits/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canPerformAction(permit.status, "suspended")) throw new HttpError(422, "INVALID_STATUS", `Cannot suspend permit in status '${permit.status}'`);
    return reply.code(202).send(await commands.suspendPermit(ctx, id, body.reason));
  });

  app.post("/v1/building/permits/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canPerformAction(permit.status, "cancelled")) throw new HttpError(422, "INVALID_STATUS", `Cannot cancel permit in status '${permit.status}'`);
    return reply.code(202).send(await commands.cancelPermit(ctx, id, body.reason));
  });

  app.post("/v1/building/permits/:id/restore", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canPerformAction(permit.status, "active")) throw new HttpError(422, "INVALID_STATUS", `Cannot restore permit in status '${permit.status}'`);
    return reply.code(202).send(await commands.restorePermit(ctx, id, body.reason));
  });
}
