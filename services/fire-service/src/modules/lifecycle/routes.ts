import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as nocRepo from "../nocs/repo.js";
import { canRequestRenewal } from "./domain.js";

const FIRE_ROLES = ["fire_user", "fire_admin", "super_admin"];
const OFFICER_ROLES = ["fire_admin", "fire_officer", "super_admin"];

const requestBody = z.object({
  nocId: z.string().uuid(),
  renewalType: z.enum(["renewal", "amendment"]),
});

const decideBody = z.object({
  decision: z.enum(["approved", "rejected"]),
});

const listQuery = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/fire/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const body = requestBody.parse(req.body);
    const noc = await nocRepo.findById(ctx.tenantId, body.nocId);
    if (!noc) throw new HttpError(404, "NOC_NOT_FOUND", "NOC not found");
    if (!canRequestRenewal(noc.status, noc.validUntil)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot request renewal for NOC in status '${noc.status}'`);
    }
    return reply.code(202).send(await commands.requestRenewal(ctx, body));
  });

  app.get("/v1/fire/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { total, limit: q.limit ?? 25, offset: q.offset ?? 0 } });
  });

  app.get("/v1/fire/renewals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "RENEWAL_NOT_FOUND", "Renewal request not found");
    return reply.send({ data: row });
  });

  app.post("/v1/fire/renewals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "RENEWAL_NOT_FOUND", "Renewal request not found");
    if (!["requested", "under_review"].includes(existing.status)) {
      throw new HttpError(422, "ALREADY_DECIDED", `Renewal already in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.decideRenewal(ctx, id, body));
  });
}
