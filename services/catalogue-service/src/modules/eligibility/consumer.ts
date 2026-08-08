import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "catalogue.eligibility.consumer" });
const AUDIT_TOPIC = "audit.event.record";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerEligibilityConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createEligibilityRule, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      productId: string;
      ruleType: string;
      criteria: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRule(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        productId: p.productId,
        ruleType: p.ruleType,
        criteria: p.criteria,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.eligibilityRuleCreated,
        eventType: EVENTS.eligibilityRuleCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { ruleId: p.id, productId: p.productId, ruleType: p.ruleType, criteria: p.criteria },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "eligibility_rule.create",
        resourceType: "catalogue_eligibility_rule",
        resourceId: p.id,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "catalogue-service", action: "eligibility_rule_create", resourceType: "eligibility", resourceId: p.id, outcome: "success" },
      });
    });
    log.info({ id: p.id }, "eligibility rule created");
  });

  queue.subscribe(COMMANDS.deleteEligibilityRule, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      productId: string;
      ruleType: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.deleteRule(tx, p.id, msg.tenantId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.eligibilityRuleDeleted,
        eventType: EVENTS.eligibilityRuleDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { ruleId: p.id, productId: p.productId, ruleType: p.ruleType, status: "deleted" },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "eligibility_rule.delete",
        resourceType: "catalogue_eligibility_rule",
        resourceId: p.id,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "catalogue-service", action: "eligibility_rule_delete", resourceType: "eligibility", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
