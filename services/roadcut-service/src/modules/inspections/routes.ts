import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canComplete } from "./domain.js";

const ADMIN_ROLES = ["roadcut_admin", "super_admin"];

const scheduleBody = z.object({
  permitId: z.string().uuid(),
  inspectionType: z.enum(["pre_work", "during_work", "post_restoration"]),
  inspectorId: z.string().uuid(),
  scheduledDate: z.string(),
});

const completeBody = z.object({
  status: z.enum(["completed", "failed"]),
  findings: z.record(z.unknown()),
  photos: z.array(z.object({
    fileId: z.string().uuid(),
    caption: z.string().optional(),
  })).optional(),
  restorationQuality: z.enum(["satisfactory", "unsatisfactory", "pending"]).optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const permitIdQuery = z.object({ permitId: z.string().uuid() });

export async function inspectionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/roadcut/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = scheduleBody.parse(req.body);
    return reply.code(202).send(
      await commands.scheduleInspection(ctx, body.permitId, body.inspectionType, body.inspectorId, body.scheduledDate),
    );
  });

  app.get("/v1/roadcut/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = permitIdQuery.parse(req.query);
    const records = await repo.listByPermit(q.permitId, ctx.tenantId);
    return reply.send({
      data: records,
      meta: { page: 1, pageSize: records.length, total: records.length },
    });
  });

  app.post("/v1/roadcut/inspections/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Inspection not found");
    if (!canComplete(existing.status)) {
      throw new HttpError(422, "ALREADY_COMPLETED", "Inspection already completed");
    }
    return reply.code(202).send(
      await commands.completeInspection(ctx, id, body.status, body.findings, body.photos, body.restorationQuality),
    );
  });
}
