import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { invalidateResolverCache } from "./resolver.js";
import type { CreateApprovalRuleBody, UpdateApprovalRuleBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

type CreatePayload = CreateApprovalRuleBody & { id: string; tenantId: string };
type UpdatePayload = { id: string; tenantId: string; patch: UpdateApprovalRuleBody };

export function registerApprovalRuleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.approvalRuleCreate, async (msg) => {
    const p = msg.payload as CreatePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRule(tx, {
        id: p.id,
        tenantId: p.tenantId,
        module: p.module,
        sourceType: p.sourceType,
        label: p.label,
        minAmountMinor: p.minAmountMinor,
        maxAmountMinor: p.maxAmountMinor,
        workflowDefinitionCode: p.workflowDefinitionCode,
        startNodeKey: p.startNodeKey,
        steps: p.steps,
        priority: p.priority,
        active: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "estab", action: "approval_rule.create", resourceType: "approval_rule",
          resourceId: p.id, outcome: "success",
          metadata: { sourceType: p.sourceType, minAmountMinor: p.minAmountMinor, maxAmountMinor: p.maxAmountMinor },
        },
      });
    });
    await invalidateResolverCache(p.tenantId, p.sourceType);
  });

  queue.subscribe(COMMANDS.approvalRuleUpdate, async (msg) => {
    const p = msg.payload as UpdatePayload;
    let sourceType: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findRuleById(p.id, p.tenantId);
      if (!existing) return;
      sourceType = existing.sourceType;

      const patch: Parameters<typeof repo.updateRule>[2] = { updatedBy: msg.actorId };
      if (p.patch.label !== undefined) patch.label = p.patch.label;
      if (p.patch.minAmountMinor !== undefined) patch.minAmountMinor = p.patch.minAmountMinor;
      if (p.patch.maxAmountMinor !== undefined) patch.maxAmountMinor = p.patch.maxAmountMinor;
      if (p.patch.workflowDefinitionCode !== undefined) patch.workflowDefinitionCode = p.patch.workflowDefinitionCode;
      if (p.patch.startNodeKey !== undefined) patch.startNodeKey = p.patch.startNodeKey;
      if (p.patch.steps !== undefined) patch.steps = p.patch.steps;
      if (p.patch.priority !== undefined) patch.priority = p.patch.priority;
      if (p.patch.active !== undefined) patch.active = p.patch.active;
      patch.version = existing.version + 1;

      await repo.updateRule(tx, p.id, patch);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "estab", action: "approval_rule.update", resourceType: "approval_rule",
          resourceId: p.id, outcome: "success", metadata: { patch: p.patch },
        },
      });
    });
    if (sourceType) await invalidateResolverCache(p.tenantId, sourceType);
  });
}
