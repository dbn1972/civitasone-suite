import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canIssueNotice, canImposePenalty, canOrderRemoval, canRecordRemoval } from "./domain.js";

const ADV_ROLES = ["adv_user", "adv_admin", "super_admin"];
const OFFICER_ROLES = ["adv_admin", "adv_officer", "adv_enforcement", "super_admin"];

const reportBody = z.object({
  permitId: z.string().uuid().optional(),
  violationType: z.enum(["unauthorized_hoarding", "expired_permit", "oversized", "unsafe_structure", "content_violation", "location_violation"]),
  description: z.string().min(1).max(2000),
  location: z.object({
    address: z.string().min(1),
    lat: z.number().optional(),
    lng: z.number().optional(),
    ward: z.string().optional(),
  }),
});

const noticeBody = z.object({ noticeDetails: z.record(z.unknown()) });
const penaltyBody = z.object({ penaltyMinor: z.string() });
const removalOrderBody = z.object({ removalDeadline: z.string().date() });
const removalRecordBody = z.object({ removalNotes: z.string().min(1).max(2000) });

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function enforcementRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/advertisement/violations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const body = reportBody.parse(req.body);
    return reply.code(202).send(await commands.reportViolation(ctx, body));
  });

  app.get("/v1/advertisement/violations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/advertisement/violations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `adv:${ctx.tenantId}:violation:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    return reply.send({ data: row });
  });

  app.post("/v1/advertisement/violations/:id/notice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = noticeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    if (!canIssueNotice(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot issue notice in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.issueNotice(ctx, id, body.noticeDetails));
  });

  app.post("/v1/advertisement/violations/:id/penalty", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = penaltyBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    if (!canImposePenalty(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot impose penalty in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.imposePenalty(ctx, id, body.penaltyMinor));
  });

  app.post("/v1/advertisement/violations/:id/removal-order", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = removalOrderBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    if (!canOrderRemoval(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot order removal in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.orderRemoval(ctx, id, body.removalDeadline));
  });

  app.post("/v1/advertisement/violations/:id/removal-record", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = removalRecordBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    if (!canRecordRemoval(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot record removal in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.recordRemoval(ctx, id, body.removalNotes));
  });
}
