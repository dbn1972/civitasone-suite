/** agents consumer — only writer for the agent aggregate. */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { z } from "zod";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, AGENT_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as queueRepo from "../queues/repo.js";
import { upsertAgentPayload } from "./validators.js";
import { AGENT_STATUSES, type AgentStatus } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

const setStatusPayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: z.enum(AGENT_STATUSES),
  expectedVersion: z.number().int().min(1).optional(),
});

export function registerAgentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.upsertAgent, async (msg) => {
    const parsed = upsertAgentPayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid upsertAgent payload: ${parsed.error.message}`);
    const p = parsed.data;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Cross-tenant ref guard: a referenced queue must live in this tenant.
      if (p.queueId && !(await queueRepo.exists(p.tenantId, p.queueId))) {
        await emitAudit(tx, msg, "upsert_agent", p.id, "rejected_cross_tenant_queue");
        return;
      }
      await repo.upsertByUser(tx, {
        id: p.id,
        tenantId: p.tenantId,
        userId: p.userId,
        displayName: p.displayName,
        queueId: p.queueId,
        status: p.status,
        extension: p.extension,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.agentUpserted, { agentRef: p.id, userId: p.userId }, "upsert_agent", p.id);
    });
    await cache.invalidateResource(msg.tenantId, AGENT_RESOURCE);
  });

  queue.subscribe(COMMANDS.setAgentStatus, async (msg) => {
    const parsed = setStatusPayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid setAgentStatus payload: ${parsed.error.message}`);
    const p = parsed.data;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const agent = await repo.findById(p.id, p.tenantId);
      if (!agent) return void (await emitAudit(tx, msg, "agent_status", p.id, "rejected_not_found"));
      if (p.expectedVersion !== undefined && agent.version !== p.expectedVersion)
        return void (await emitAudit(tx, msg, "agent_status", p.id, "rejected_version_conflict"));
      const n = await repo.setStatus(tx, p.id, p.tenantId, p.status as AgentStatus, p.expectedVersion ?? agent.version, msg.actorId);
      if (n === 0) return void (await emitAudit(tx, msg, "agent_status", p.id, "rejected_version_conflict"));
      await emit(tx, msg, EVENTS.agentStatusChanged, { agentRef: p.id, status: p.status }, "agent_status", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, AGENT_RESOURCE, p.id));
    await cache.invalidateResource(msg.tenantId, AGENT_RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "telephony", action, resourceType: "agent", resourceId, outcome: "success" },
  });
}

async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "telephony", action, resourceType: "agent", resourceId, outcome },
  });
}
