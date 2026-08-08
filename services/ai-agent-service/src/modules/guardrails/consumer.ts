import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "ai.guardrails.consumer" });
const AUDIT_TOPIC = "audit.event.record";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerGuardrailConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.checkGuardrails, async (msg) => {
    const p = msg.payload as {
      sanitizedInput: string;
      passed: boolean;
      reason: string | null;
      agentId?: string;
      injectionDetected: boolean;
      injectionSeverity: string;
      injectionPatterns: string[];
      injectionBlocked: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (p.injectionDetected) {
        await enqueue(tx, {
          topic: EVENTS.injectionDetected,
          eventType: EVENTS.injectionDetected,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            severity: p.injectionSeverity,
            patterns: p.injectionPatterns,
            blocked: p.injectionBlocked,
            ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
          },
        });
      }

      await writeAudit(tx, ctxOf(msg) as never, {
        ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
        action: "guardrails.check",
        input: p.sanitizedInput,
        output: null,
        blocked: !p.passed,
        reason: p.reason,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "guardrails_check", resourceType: "guardrails", resourceId: msg.messageId, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.checkInjection, async (msg) => {
    const p = msg.payload as {
      agentId?: string;
      severity: string;
      patterns: string[];
      blocked: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await enqueue(tx, {
        topic: EVENTS.injectionDetected,
        eventType: EVENTS.injectionDetected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          severity: p.severity,
          patterns: p.patterns,
          blocked: p.blocked,
          ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
        },
      });

      await writeAudit(tx, ctxOf(msg) as never, {
        ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
        action: "guardrails.check_injection",
        input: null,
        output: p.patterns.join(", "),
        blocked: p.blocked,
        reason: `severity ${p.severity}`,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "guardrails_check_injection", resourceType: "guardrails", resourceId: msg.messageId, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.createGuardrailRule, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      ruleType: string;
      pattern: string | null;
      config: Record<string, unknown>;
      severity: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        ruleType: p.ruleType as never,
        pattern: p.pattern,
        config: p.config,
        severity: p.severity as never,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "guardrails.rule_create",
        input: p.name,
        output: null,
        blocked: false,
        reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "guardrail_rule_create", resourceType: "guardrails", resourceId: p.id, outcome: "success" },
      });
    });
    log.info({ id: p.id }, "guardrail rule created");
  });

  queue.subscribe(COMMANDS.updateGuardrailRule, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      version: number;
      patch: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { ...p.patch, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "guardrails.rule_update",
        input: JSON.stringify(Object.keys(p.patch)),
        output: null,
        blocked: false,
        reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "guardrail_rule_update", resourceType: "guardrails", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.deleteGuardrailRule, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.softDelete(tx, p.id, msg.tenantId, p.version, msg.actorId);
      if (!ok) return;
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "guardrails.rule_delete",
        input: null,
        output: null,
        blocked: false,
        reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "guardrail_rule_delete", resourceType: "guardrails", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
