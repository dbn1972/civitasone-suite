import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { AppraisalSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

const APAR_STAGES = ["self_pending", "reporting_officer", "reviewing_officer", "accepting_authority", "completed"] as const;

export async function appraisalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/appraisals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, AppraisalSummaryListSchema, await queries.listAppraisals(ctx.tenantId, q.limit));
  });

  app.post("/v1/hrms/appraisals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      appraisalPeriod: z.string().min(4).max(16),
      reviewerId: z.string().uuid().optional(),
    }).parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertAppraisal(tx, {
        id, tenantId: ctx.tenantId, employeeId: body.employeeId,
        appraisalPeriod: body.appraisalPeriod, status: "self_pending",
        reviewerId: body.reviewerId ?? null,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
    });
    return reply.code(202).send({ id, status: "self_pending", stage: "APAR initiated" });
  });

  app.patch("/v1/hrms/appraisals/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      stage: z.enum(APAR_STAGES),
      rating: z.string().optional(),
    }).parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "appraisal not found");
    await db.transaction(async (tx) => {
      await repo.updateAppraisal(tx, id, {
        status: body.stage,
        rating: body.rating ?? existing.rating,
        updatedBy: ctx.actorId,
      });
    });
    return reply.send({ id, status: body.stage, rating: body.rating ?? existing.rating });
  });
}
