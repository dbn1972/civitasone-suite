import type { Queue, CommandOutcome } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, recordCommandOutcome } from "../../shared/outbox.js";
import { runWithTenant } from "@civitasone/db";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import { transitionState, validateMakerChecker } from "./domain.js";
import * as templateRepo from "../templates/repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * G-ASYNC-1: persist this command's terminal outcome so
 * `GET /v1/templates/commands/:commandId/status` (routes.ts) can answer a
 * caller polling the `id` their 202 response returned — see that route, and
 * @civitasone/outbox's recordCommandOutcome, for the full picture.
 *
 * Every command here already has a synchronous pre-check in routes.ts
 * (not-found / INVALID_TRANSITION / MAKER_CHECKER_VIOLATION, mirroring this
 * consumer's own checks below) — this is still needed: the pre-check reads
 * state at accept time, this consumer re-validates the SAME conditions
 * against whatever the state actually is when the command is processed,
 * which can be later and can disagree (another command may have changed the
 * template's status in between). When it disagrees, this is currently the
 * ONLY way that residual rejection is ever detectable by the caller.
 *
 * Wrapped in runWithTenant + db.transaction (not a bare write) so the
 * FORCE-RLS `_inbox.command_results` insert carries the right app.tenant_id
 * GUC — bus.ts invokes onOutcome OUTSIDE withTenantConsumer's scope (that
 * wrapper only covers the handler call itself; see tenant-queue.ts).
 */
async function recordApprovalCommandOutcome(outcome: CommandOutcome): Promise<void> {
  await runWithTenant(outcome.tenantId, () =>
    db.transaction((tx) => recordCommandOutcome(tx, outcome)),
  );
}

export function registerApprovalConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  // Submit template for review: draft → in_review
  q.subscribe<{ templateId: string; tenantId: string; submittedBy: string }>(
    COMMANDS.submitTemplate, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;

        const template = await templateRepo.findTemplateByIdTx(tx, p.templateId);
        if (!template) throw new NonRetryableError("TEMPLATE_NOT_FOUND", `Template ${p.templateId} not found`);

        const result = transitionState(template.status, "submit");
        if (!result.ok) throw new NonRetryableError("INVALID_TRANSITION", result.error);

        await templateRepo.updateTemplateStatus(tx, p.templateId, result.newStatus, {
          submittedBy: p.submittedBy,
          submittedAt: new Date(),
          updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.templateSubmitted,
          eventType: EVENTS.templateSubmitted,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { templateId: p.templateId, submittedBy: p.submittedBy },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "notification", action: "submit_template", resourceType: "template", resourceId: p.templateId, outcome: "success" },
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.template, msg.payload.templateId));
    },
    { onOutcome: recordApprovalCommandOutcome },
  );

  // Approve template: in_review → approved
  q.subscribe<{ templateId: string; tenantId: string; approvedBy: string }>(
    COMMANDS.approveTemplate, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;

        const template = await templateRepo.findTemplateByIdTx(tx, p.templateId);
        if (!template) throw new NonRetryableError("TEMPLATE_NOT_FOUND", `Template ${p.templateId} not found`);

        const result = transitionState(template.status, "approve");
        if (!result.ok) throw new NonRetryableError("INVALID_TRANSITION", result.error);

        // Maker-checker enforcement: submitter cannot approve own template
        const submittedBy = (template as { submittedBy?: string }).submittedBy;
        if (submittedBy && !validateMakerChecker(submittedBy, p.approvedBy)) {
          throw new NonRetryableError("MAKER_CHECKER_VIOLATION", "The submitter cannot approve their own template");
        }

        await templateRepo.updateTemplateStatus(tx, p.templateId, result.newStatus, {
          approvedBy: p.approvedBy,
          approvedAt: new Date(),
          updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.templateApproved,
          eventType: EVENTS.templateApproved,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { templateId: p.templateId, approvedBy: p.approvedBy },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "notification", action: "approve_template", resourceType: "template", resourceId: p.templateId, outcome: "success" },
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.template, msg.payload.templateId));
    },
    { onOutcome: recordApprovalCommandOutcome },
  );

  // Reject template: in_review → draft (returned for rework)
  q.subscribe<{ templateId: string; tenantId: string; rejectedBy: string; reason: string }>(
    COMMANDS.rejectTemplate, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;

        const template = await templateRepo.findTemplateByIdTx(tx, p.templateId);
        if (!template) throw new NonRetryableError("TEMPLATE_NOT_FOUND", `Template ${p.templateId} not found`);

        const result = transitionState(template.status, "reject");
        if (!result.ok) throw new NonRetryableError("INVALID_TRANSITION", result.error);

        await templateRepo.updateTemplateStatus(tx, p.templateId, result.newStatus, {
          rejectionReason: p.reason,
          updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.templateRejected,
          eventType: EVENTS.templateRejected,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { templateId: p.templateId, rejectedBy: p.rejectedBy, reason: p.reason },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "notification", action: "reject_template", resourceType: "template", resourceId: p.templateId, outcome: "success" },
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.template, msg.payload.templateId));
    },
    { onOutcome: recordApprovalCommandOutcome },
  );

  // Publish template: approved → published
  q.subscribe<{ templateId: string; tenantId: string; publishedBy: string }>(
    COMMANDS.publishTemplate, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;

        const template = await templateRepo.findTemplateByIdTx(tx, p.templateId);
        if (!template) throw new NonRetryableError("TEMPLATE_NOT_FOUND", `Template ${p.templateId} not found`);

        const result = transitionState(template.status, "publish");
        if (!result.ok) throw new NonRetryableError("INVALID_TRANSITION", result.error);

        await templateRepo.updateTemplateStatus(tx, p.templateId, result.newStatus, {
          updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.templatePublished,
          eventType: EVENTS.templatePublished,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { templateId: p.templateId, publishedBy: p.publishedBy },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "notification", action: "publish_template", resourceType: "template", resourceId: p.templateId, outcome: "success" },
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.template, msg.payload.templateId));
      await cache.invalidate(cache.makeKey(msg.tenantId, `${RESOURCE.template}_list`, msg.tenantId));
    },
    { onOutcome: recordApprovalCommandOutcome },
  );
}
