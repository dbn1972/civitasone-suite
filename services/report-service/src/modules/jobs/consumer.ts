/**
 * Consumer — the ONLY code that writes Postgres.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { JobView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerJobConsumers(queue: Queue): void {
  queue.subscribe<JobView>(COMMANDS.createJob, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        reportType: p.reportType,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.jobCreated, { jobId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);

    // Trigger the render pipeline — the render consumer will produce the actual file
    const p = msg.payload;
    await queue.publish(COMMANDS.renderJob, {
      messageId: `render-${p.id}`,
      type: COMMANDS.renderJob,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      schemaVersion: "1.0",
      payload: {
        jobId: p.id,
        tenantId: msg.tenantId,
        templateHtml: `<html><body><h1>${p.name}</h1><p>Report type: ${p.reportType ?? "general"}</p><p>Generated at: ${new Date().toISOString()}</p></body></html>`,
        format: (p.format ?? "pdf") as "pdf" | "xlsx" | "csv" | "html",
      },
    });
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
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
    payload: { service: "reports", action, resourceType: "job", resourceId, outcome: "success" },
  });
}
