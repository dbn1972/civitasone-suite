import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const STEWARD_ROLES = ["cdp_steward", "cdp_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

const decideBody = z.object({
  mergeRequestId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(1000).optional(),
});

export async function stewardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/cdp/steward/queue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STEWARD_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByStatus(ctx.tenantId, q.limit, q.offset, q.status);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  app.post("/v1/cdp/steward/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STEWARD_ROLES);
    const body = decideBody.parse(req.body);

    const mergeRequest = await repo.findById(body.mergeRequestId, ctx.tenantId);
    if (!mergeRequest) throw new HttpError(404, "NOT_FOUND", "merge request not found");
    if (mergeRequest.status !== "pending") {
      throw new HttpError(409, "ALREADY_DECIDED", `merge request is already ${mergeRequest.status}`);
    }

    return reply.code(202).send(await commands.decideMerge(ctx, {
      mergeRequestId: body.mergeRequestId,
      decision: body.decision,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    }));
  });
}
