/**
 * dsar/routes.ts — CDP-011 DSAR intake (queue-first).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import { DSAR_REQUEST_TYPES, DSAR_STATUSES, isCompletable } from "./domain.js";
import * as commands from "./commands.js";

const DSAR_READ_ROLES = ["cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const DSAR_WRITE_ROLES = ["cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];

const raiseBody = z.object({
  profileId: z.string().uuid(),
  requestType: z.enum(DSAR_REQUEST_TYPES),
  reason: z.string().min(1).max(2000).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(DSAR_STATUSES).optional(),
  profileId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const completeBody = z.object({
  version: z.number().int().min(1),
  note: z.string().max(2000).optional(),
});

export async function dsarRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/cdp/dsar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DSAR_WRITE_ROLES);
    const body = raiseBody.parse(req.body);

    const profile = await profilesRepo.findById(body.profileId, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    return reply.code(202).send(
      await commands.raiseDsar(ctx, {
        profileId: body.profileId,
        requestType: body.requestType,
        reason: body.reason ?? null,
      }),
    );
  });

  app.get("/v1/cdp/dsar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DSAR_READ_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.profileId !== undefined ? { profileId: q.profileId } : {}),
    });
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  app.post("/v1/cdp/dsar/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DSAR_WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "dsar request not found");
    if (!isCompletable(existing.status)) {
      throw new HttpError(422, "DSAR_TERMINAL", `dsar request is already ${existing.status}`);
    }
    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "dsar request has been modified; retry with current version");
    }

    return reply.code(202).send(await commands.completeDsar(ctx, id, {
      version: body.version,
      ...(body.note !== undefined ? { note: body.note } : {}),
    }));
  });
}
