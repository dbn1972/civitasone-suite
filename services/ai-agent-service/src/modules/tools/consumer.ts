import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { defaultToolsFor } from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "ai.tools.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerToolConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.defineTool, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      agentDomain: string;
      toolName: string;
      description: string | null;
      inputSchema: Record<string, unknown>;
      requiresApproval: boolean;
      enabled: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        agentDomain: p.agentDomain as never,
        toolName: p.toolName,
        description: p.description,
        inputSchema: p.inputSchema,
        requiresApproval: p.requiresApproval,
        enabled: p.enabled,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.toolDefined,
        eventType: EVENTS.toolDefined,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          toolId: p.id,
          agentDomain: p.agentDomain,
          toolName: p.toolName,
          requiresApproval: p.requiresApproval,
        },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "tool.define",
        input: `${p.agentDomain}/${p.toolName}`,
        output: p.id,
        blocked: false,
        reason: null,
      });
    });
    await cache.invalidateResource(msg.tenantId, "tools");
    log.info({ id: p.id }, "tool defined");
  });

  queue.subscribe(COMMANDS.updateTool, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      version: number;
      patch: Record<string, unknown>;
      agentDomain: string;
      toolName: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { ...p.patch, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.toolUpdated,
        eventType: EVENTS.toolUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { toolId: p.id, agentDomain: p.agentDomain, toolName: p.toolName },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "tool.update",
        input: JSON.stringify(Object.keys(p.patch)),
        output: null,
        blocked: false,
        reason: null,
      });
    });
    await cache.invalidateResource(msg.tenantId, "tools");
  });

  queue.subscribe(COMMANDS.seedDefaultTools, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      agentDomain: string;
      templates?: Array<{
        agentDomain: string;
        toolName: string;
        description: string | null;
        inputSchema: Record<string, unknown>;
        requiresApproval: boolean;
      }>;
    };
    const templates = p.templates ?? defaultToolsFor(
      p.agentDomain === "all" ? undefined : p.agentDomain as never,
    );
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await repo.insertManyIgnoreConflicts(
        tx,
        templates.map((t) => ({
          id: randomUUID(),
          tenantId: p.tenantId,
          agentDomain: t.agentDomain as never,
          toolName: t.toolName,
          description: t.description,
          inputSchema: t.inputSchema,
          requiresApproval: t.requiresApproval,
          enabled: true,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        })),
      );
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "tool.seed_defaults",
        input: p.agentDomain,
        output: String(inserted),
        blocked: false,
        reason: null,
      });
    });
    await cache.invalidateResource(msg.tenantId, "tools");
  });

  queue.subscribe(COMMANDS.recordReactStep, async (msg) => {
    const p = msg.payload as {
      stepId: string;
      tenantId: string;
      agentId: string;
      toolId: string;
      stepNo: number;
      thought: string;
      action: string;
      actionInput: Record<string, unknown>;
      observation: string | null;
      orchestrationId?: string;
      status: string;
      executed: boolean;
      decisionCode: string;
      decisionMessage: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertStep(tx, {
        id: p.stepId,
        tenantId: p.tenantId,
        agentId: p.agentId,
        ...(p.orchestrationId !== undefined ? { orchestrationId: p.orchestrationId } : {}),
        toolId: p.toolId,
        stepNo: p.stepNo,
        thought: p.thought,
        action: p.action,
        actionInput: p.actionInput,
        observation: p.observation,
        status: p.status as never,
        executed: p.executed,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: p.executed ? EVENTS.reactStepRecorded : EVENTS.reactStepPendingApproval,
        eventType: p.executed ? EVENTS.reactStepRecorded : EVENTS.reactStepPendingApproval,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          agentId: p.agentId,
          stepId: p.stepId,
          action: p.action,
          toolId: p.toolId,
          executed: p.executed,
        },
      });

      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.agentId,
        action: "agent.react_step",
        input: p.thought,
        output: p.observation,
        blocked: !p.executed,
        reason: p.executed ? null : p.decisionMessage,
      });
    });
  });
}
