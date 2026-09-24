import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { getCommandOutcome } from "../../shared/outbox.js";
import { scopedRead } from "../../shared/db.js";
import { transitionState, validateMakerChecker } from "./domain.js";
import * as commands from "./commands.js";
import * as templateQueries from "../templates/queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin", "notification_admin"];
const APPROVERS = ["platform_admin", "super_admin", "tenant_admin", "notification_admin", "notification_approver"];
const READERS = [...APPROVERS];

const templateIdParam = z.object({ id: z.string().uuid() });
const rejectBody = z.object({ reason: z.string().min(1).max(500) });
const commandIdParam = z.object({ commandId: z.string().uuid() });

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // Submit template for review
  app.post("/v1/templates/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = templateIdParam.parse(req.params);

    // Pre-validate transition
    const template = await templateQueries.getTemplateById(ctx.tenantId, id);
    if (!template) throw new HttpError(404, "NOT_FOUND", "Template not found");
    const result = transitionState(template.status, "submit");
    if (!result.ok) throw new HttpError(422, "INVALID_TRANSITION", result.error);

    return sendAccepted(reply, acceptedResponseSchema, await commands.submitForReview(ctx, id));
  });

  // Approve template
  app.post("/v1/templates/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVERS);
    const { id } = templateIdParam.parse(req.params);

    const template = await templateQueries.getTemplateById(ctx.tenantId, id);
    if (!template) throw new HttpError(404, "NOT_FOUND", "Template not found");
    const result = transitionState(template.status, "approve");
    if (!result.ok) throw new HttpError(422, "INVALID_TRANSITION", result.error);

    // Maker-checker: submitter cannot approve
    const submittedBy = (template as { submittedBy?: string }).submittedBy;
    if (submittedBy && !validateMakerChecker(submittedBy, ctx.actorId)) {
      throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "You cannot approve a template you submitted");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.approve(ctx, id));
  });

  // Reject template
  app.post("/v1/templates/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVERS);
    const { id } = templateIdParam.parse(req.params);
    const body = rejectBody.parse(req.body);

    const template = await templateQueries.getTemplateById(ctx.tenantId, id);
    if (!template) throw new HttpError(404, "NOT_FOUND", "Template not found");
    const result = transitionState(template.status, "reject");
    if (!result.ok) throw new HttpError(422, "INVALID_TRANSITION", result.error);

    return sendAccepted(reply, acceptedResponseSchema, await commands.reject(ctx, id, body.reason));
  });

  // Publish template
  app.post("/v1/templates/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = templateIdParam.parse(req.params);

    const template = await templateQueries.getTemplateById(ctx.tenantId, id);
    if (!template) throw new HttpError(404, "NOT_FOUND", "Template not found");
    const result = transitionState(template.status, "publish");
    if (!result.ok) throw new HttpError(422, "INVALID_TRANSITION", result.error);

    return sendAccepted(reply, acceptedResponseSchema, await commands.publish(ctx, id));
  });

  // G-ASYNC-1: poll a command's eventual outcome using the `id` any of the
  // 202 responses above returned (it is the underlying queue messageId —
  // see @civitasone/outbox's commandResults doc comment). Answers
  // docs/API-GUIDE.md §3.1's documented "poll the resource... or use the
  // returned id to check status" contract. Every route above already does a
  // synchronous pre-check (not-found / INVALID_TRANSITION /
  // MAKER_CHECKER_VIOLATION) before publishing, but that check reads state
  // at accept time — the consumer (approval/consumer.ts) re-validates the
  // same conditions against whatever the state actually is when the command
  // is processed, which can be later and can disagree. Before this change,
  // that residual rejection was invisible: the 202 had already gone out and
  // nothing else ever told the caller their approve/reject/submit/publish
  // didn't actually happen.
  app.get("/v1/templates/commands/:commandId/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READERS);
    const { commandId } = commandIdParam.parse(req.params);
    // scopedRead (shared/db.ts) runs inside db.transaction() so RLS's
    // app.tenant_id GUC is actually set for this read.
    const outcome = await scopedRead((tx) => getCommandOutcome(tx, commandId));
    if (!outcome) return reply.send({ commandId, status: "processing" });
    return reply.send({ commandId, status: outcome.status, reason: outcome.reason, occurredAt: outcome.occurredAt });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
