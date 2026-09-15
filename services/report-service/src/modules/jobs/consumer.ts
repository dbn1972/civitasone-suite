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
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerJobConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
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

      // TX-009: trigger the render pipeline through the transactional outbox
      // instead of a direct post-commit queue.publish. The old code called
      // queue.publish(COMMANDS.renderJob, ...) AFTER this transaction had
      // already committed (markProcessed included), so any crash or publish
      // failure in that gap permanently stranded the job: a genuine
      // redelivery of this same createJob message sees markProcessed return
      // false and skips the whole handler body, so the render command is
      // never (re)issued and the job never completes. Enqueuing it here
      // makes "processed" and "render will be triggered" atomic — either
      // both commit together, or neither does and a real redelivery safely
      // retries the whole thing from scratch. The outbox assigns its own
      // row id as the relayed messageId (see relayOnce in
      // packages/outbox/src/index.ts), so the old hand-rolled
      // `render-${p.id}` messageId is dropped -- it was never load-bearing
      // anyway, since a createJob redelivery already short-circuited on
      // markProcessed before reaching this line.
      await enqueue(tx, {
        topic: COMMANDS.renderJob,
        eventType: COMMANDS.renderJob,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          jobId: p.id,
          tenantId: msg.tenantId,
          templateHtml: `<html><body><h1>${p.name}</h1><p>Report type: ${p.reportType ?? "general"}</p><p>Generated at: ${new Date().toISOString()}</p></body></html>`,
          format: (p.format ?? "pdf") as "pdf" | "xlsx" | "csv" | "html",
        },
      });
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
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
