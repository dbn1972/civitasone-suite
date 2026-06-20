import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, QUERY_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { QueryRunView } from "./schema.js";
const AUDIT_TOPIC = "audit.event.record";
export function registerQueriesConsumers(queue: Queue): void {
  queue.subscribe<QueryRunView>(COMMANDS.runQuery, async (msg) => {
    const resultRows = Math.floor(Math.random() * 100) + 1;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        dashboardId: p.dashboardId,
        queryName: p.queryName,
        status: "running",
        resultRows: 0,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await repo.complete(tx, p.id, resultRows, msg.actorId);
      await emit(tx, msg, EVENTS.queryRun, { queryRunId: p.id, queryName: p.queryName, resultRows }, "run", p.id);
    });
    const completed = { ...msg.payload, status: "completed", resultRows, version: 1 };
    await cache.put(cache.makeKey(msg.tenantId, QUERY_RESOURCE, msg.payload.id), completed);
    await cache.invalidateResource(msg.tenantId, QUERY_RESOURCE);
  });
}
async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "analytics", action, resourceType: "query_run", resourceId, outcome: "success" } });
}
