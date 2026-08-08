import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "ai.agents.consumer" });
const AUDIT_TOPIC = "audit.event.record";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerAgentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createAgent, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      skills: Record<string, unknown>[];
      tools: Record<string, unknown>[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        skills: p.skills,
        tools: p.tools,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.id,
        action: "agent.create",
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
        payload: { service: "ai-agent-service", action: "agent_create", resourceType: "agent", resourceId: p.id, outcome: "success" },
      });
    });
    log.info({ id: p.id }, "agent created");
  });

  queue.subscribe(COMMANDS.updateAgent, async (msg) => {
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
        agentId: p.id,
        action: "agent.update",
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
        payload: { service: "ai-agent-service", action: "agent_update", resourceType: "agent", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.deleteAgent, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.archive(tx, p.id, msg.tenantId, p.version, msg.actorId);
      if (!ok) return;
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.id,
        action: "agent.archive",
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
        payload: { service: "ai-agent-service", action: "agent_archive", resourceType: "agent", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.pauseAgent, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "paused", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.agentPaused,
        eventType: EVENTS.agentPaused,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { agentId: p.id },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.id,
        action: "agent.pause",
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
        payload: { service: "ai-agent-service", action: "agent_pause", resourceType: "agent", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.resumeAgent, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "active", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.id,
        action: "agent.resume",
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
        payload: { service: "ai-agent-service", action: "agent_resume", resourceType: "agent", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.handoffAgent, async (msg) => {
    const p = msg.payload as {
      fromAgentId: string;
      toAgentId: string;
      requiredSkill: string;
      conversationId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: EVENTS.handoffTriggered,
        eventType: EVENTS.handoffTriggered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          fromAgentId: p.fromAgentId,
          toAgentId: p.toAgentId,
          requiredSkill: p.requiredSkill,
          ...(p.conversationId !== undefined ? { conversationId: p.conversationId } : {}),
        },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.fromAgentId,
        action: "agent.handoff",
        input: p.requiredSkill,
        output: p.toAgentId,
        blocked: false,
        reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "agent_handoff", resourceType: "agent", resourceId: p.fromAgentId, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.invokeAgent, async (msg) => {
    const p = msg.payload as {
      agentId: string;
      invocationId: string;
      sanitizedInput: string | null;
      conversationId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: EVENTS.turnCompleted,
        eventType: EVENTS.turnCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          agentId: p.agentId,
          invocationId: p.invocationId,
          ...(p.conversationId !== undefined ? { conversationId: p.conversationId } : {}),
        },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.agentId,
        action: "agent.invoke",
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
        payload: { service: "ai-agent-service", action: "agent_invoke", resourceType: "agent", resourceId: p.agentId, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.recordBlockedAudit, async (msg) => {
    const p = msg.payload as {
      agentId?: string;
      action: string;
      input: string | null;
      output: string | null;
      blocked: boolean;
      reason: string;
      kind?: string;
      severity?: string;
      patterns?: string[];
      conversationId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (p.kind === "injection" && p.patterns) {
        await enqueue(tx, {
          topic: EVENTS.injectionDetected,
          eventType: EVENTS.injectionDetected,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            severity: p.severity,
            patterns: p.patterns,
            blocked: true,
            ...(p.conversationId !== undefined ? { conversationId: p.conversationId } : {}),
          },
        });
      }
      if (p.kind === "orchestration_limit") {
        const limit = p as typeof p & {
          orchestrationId?: string;
          code?: string;
          depth?: number;
          hopCount?: number;
        };
        await enqueue(tx, {
          topic: EVENTS.orchestrationLimitExceeded,
          eventType: EVENTS.orchestrationLimitExceeded,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            orchestrationId: limit.orchestrationId,
            code: limit.code,
            depth: limit.depth,
            hopCount: limit.hopCount,
          },
        });
      }
      await writeAudit(tx, ctxOf(msg) as never, {
        ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
        action: p.action,
        input: p.input,
        output: p.output,
        blocked: p.blocked,
        reason: p.reason,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "record_blocked_audit", resourceType: "agent", resourceId: p.agentId ?? msg.messageId, outcome: "success" },
      });
    });
  });
}
