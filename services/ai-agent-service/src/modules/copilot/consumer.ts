import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "ai.copilot.consumer" });
const AUDIT_TOPIC = "audit.event.record";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerCopilotConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.askCopilot, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      sanitizedInput: string;
      citations: Record<string, unknown>[];
      model: string | null;
      latencyMs: number;
      violationCount: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        userId: msg.actorId,
        prompt: p.sanitizedInput,
        response: null,
        sourceCitations: p.citations as never,
        model: p.model,
        tokens: null,
        latencyMs: p.latencyMs,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.turnCompleted,
        eventType: EVENTS.turnCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          turnId: p.id,
          kind: "copilot_ask",
          citations: p.citations.length,
          latencyMs: p.latencyMs,
        },
      });

      await writeAudit(tx, ctxOf(msg) as never, {
        action: "copilot.ask",
        input: p.sanitizedInput,
        output: null,
        blocked: false,
        reason: p.violationCount > 0 ? "guardrail warnings recorded" : null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "copilot_ask", resourceType: "copilot", resourceId: p.id, outcome: "success" },
      });
    });
    log.info({ id: p.id }, "copilot ask accepted");
  });

  queue.subscribe(COMMANDS.summarize, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      sanitizedInput: string;
      model: string | null;
      maxLength: number | null;
      latencyMs: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        userId: msg.actorId,
        prompt: p.sanitizedInput,
        response: null,
        sourceCitations: [],
        model: p.model,
        tokens: null,
        latencyMs: p.latencyMs,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await writeAudit(tx, ctxOf(msg) as never, {
        action: "copilot.summarize",
        input: p.sanitizedInput,
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
        payload: { service: "ai-agent-service", action: "copilot_summarize", resourceType: "copilot", resourceId: p.id, outcome: "success" },
      });
    });
    log.info({ id: p.id }, "copilot summarize accepted");
  });

  queue.subscribe(COMMANDS.suggest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; taskType: string; confidence: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, userId: msg.actorId,
        prompt: `copilot.suggest:${p.taskType}`, response: null, sourceCitations: [],
        model: null, tokens: null, latencyMs: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.turnCompleted, eventType: EVENTS.turnCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { turnId: p.id, kind: "copilot_suggest", taskType: p.taskType, confidence: p.confidence },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "copilot.suggest", input: p.taskType, output: null, blocked: false, reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "copilot_suggest", resourceType: "copilot", resourceId: p.id, outcome: "success" },
      });
    });
    log.info({ id: p.id }, "copilot suggest persisted");
  });
}
