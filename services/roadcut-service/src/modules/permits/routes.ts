import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canExtend, canComplete, canCancel } from "./domain.js";
import * as applicationsRepo from "../applications/repo.js";

const ROADCUT_ROLES = ["roadcut_user", "roadcut_admin", "super_admin"];
const ADMIN_ROLES = ["roadcut_admin", "super_admin"];

// workStartDate/workEndDate/extendedUntil are stored in `date` columns and
// fed straight through to Postgres with no other validation — an
// unparseable string would abort the consumer's insert/update permanently
// (the same "accepted but never applied" poison-pill shape confirmed live
// for applications' cuttingLength). Zod's .date() enforces real ISO
// (YYYY-MM-DD) dates at the route boundary instead.
const issueBody = z.object({
  applicationId: z.string().uuid(),
  workStartDate: z.string().date(),
  workEndDate: z.string().date(),
  conditions: z.record(z.unknown()).optional(),
});

const extendBody = z.object({ extendedUntil: z.string().date() });
const cancelBody = z.object({ reason: z.string().min(1) });

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function permitRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/roadcut/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = issueBody.parse(req.body);

    // A permit is a legal document issued against a specific, approved
    // application. Previously nothing checked the application even existed
    // (no FK in the schema either) — confirmed live: a permit could be
    // issued against a random non-existent UUID, or against a "draft" /
    // "rejected" application, identically to an "approved" one.
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
    if (application.feeMinor == null || application.depositMinor == null) {
      throw new HttpError(422, "FEE_NOT_SET", "Application fee/deposit have not been calculated; cannot issue permit");
    }
    const existingPermit = await repo.findByApplication(body.applicationId, ctx.tenantId);
    if (existingPermit) {
      throw new HttpError(409, "PERMIT_ALREADY_EXISTS", "A permit has already been issued for this application");
    }

    if (new Date(body.workEndDate).getTime() <= new Date(body.workStartDate).getTime()) {
      throw new HttpError(422, "INVALID_DATE_RANGE", "workEndDate must be after workStartDate");
    }

    return reply.code(202).send(
      await commands.issuePermit(ctx, body.applicationId, body.workStartDate, body.workEndDate, body.conditions),
    );
  });

  app.get("/v1/roadcut/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/roadcut/permits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `roadcut:${ctx.tenantId}:permit:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    return reply.send({ data: row });
  });

  app.post("/v1/roadcut/permits/:id/extend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = extendBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canExtend(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot extend permit in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.extendPermit(ctx, id, body.extendedUntil));
  });

  app.post("/v1/roadcut/permits/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canComplete(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot complete permit in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.completePermit(ctx, id));
  });

  app.post("/v1/roadcut/permits/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canCancel(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel permit in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.cancelPermit(ctx, id, body.reason));
  });
}
