import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { AppraisalSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
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
    await queue.publish(COMMANDS.appraisalCreate, {
      messageId: id, type: COMMANDS.appraisalCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, employeeId: body.employeeId, appraisalPeriod: body.appraisalPeriod, reviewerId: body.reviewerId ?? null, status: "self_pending" },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.patch("/v1/hrms/appraisals/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      stage: z.enum(APAR_STAGES),
      rating: z.string().optional(),
    }).parse(req.body);
    // Verify the appraisal exists before publishing the command
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "appraisal not found");
    const messageId = randomUUID();
    await queue.publish(COMMANDS.appraisalAdvanceStage, {
      messageId, type: COMMANDS.appraisalAdvanceStage,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, stage: body.stage, rating: body.rating ?? null },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });
}
