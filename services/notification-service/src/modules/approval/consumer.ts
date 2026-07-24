import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import { transitionState, validateMakerChecker } from "./domain.js";
import * as templateRepo from "../templates/repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerApprovalConsumers(q: Queue): void {
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
  );
}
