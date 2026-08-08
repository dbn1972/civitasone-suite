import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "ai.authoring.consumer" });
const AUDIT_TOPIC = "audit.event.record";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerAuthoringConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.draftAgentDefinition, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      description: string | null;
      systemPrompt: string;
      tools: Record<string, unknown>[];
      modelConfig: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        description: p.description,
        systemPrompt: p.systemPrompt,
        tools: p.tools,
        modelConfig: p.modelConfig,
        status: "draft",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.agentDefinitionDrafted,
        eventType: EVENTS.agentDefinitionDrafted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { definitionId: p.id, name: p.name },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "authoring.create",
        input: p.name,
        output: p.id,
        blocked: false,
        reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "authoring_create", resourceType: "authoring", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "authoring-agents");
    log.info({ id: p.id }, "agent definition drafted");
  });

  queue.subscribe(COMMANDS.updateAgentDefinition, async (msg) => {
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
        action: "authoring.update",
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
        payload: { service: "ai-agent-service", action: "authoring_update", resourceType: "authoring", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "authoring-agents");
  });

  queue.subscribe(COMMANDS.publishAgentDefinition, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      version: number;
      name: string;
      toolCount: number;
      publishedAt: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.id,
        msg.tenantId,
        { status: "published", publishedAt: new Date(p.publishedAt), updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.agentDefinitionPublished,
        eventType: EVENTS.agentDefinitionPublished,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { definitionId: p.id, name: p.name, toolCount: p.toolCount },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "authoring.publish",
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
        payload: { service: "ai-agent-service", action: "authoring_publish", resourceType: "authoring", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "authoring-agents");
  });

  queue.subscribe(COMMANDS.archiveAgentDefinition, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.id,
        msg.tenantId,
        { status: "archived", updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.agentDefinitionArchived,
        eventType: EVENTS.agentDefinitionArchived,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { definitionId: p.id },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "authoring.archive",
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
        payload: { service: "ai-agent-service", action: "authoring_archive", resourceType: "authoring", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "authoring-agents");
  });
}
