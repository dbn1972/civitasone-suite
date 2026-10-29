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
import { buildJobReportHtml } from "../../shared/report-html.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerJobConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe<JobView & { piiUnmask?: { reason: string } }>(COMMANDS.createJob, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        reportType: p.reportType,
        status: p.status,
        ...(p.parameters ? { parameters: p.parameters } : {}),
        // SEC: requested_by is the ACTOR who created the job (from the
        // authenticated envelope, never the client payload) so per-user
        // scoping works. It was previously never persisted.
        requestedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.jobCreated, { jobId: p.id, name: p.name }, "create", p.id);
      // Owner decision #17: an unmasked-PII request is always audited, with its reason.
      const unmaskReason = p.piiUnmask?.reason?.trim();
      if (unmaskReason) {
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "reports", action: "pii_unmask_requested", resourceType: "job", resourceId: p.id, outcome: "success", unmaskReason },
        });
      }

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
          // Job names are user input: escaped (SSRF via the headless renderer).
          templateHtml: buildJobReportHtml(p.name, p.reportType, new Date()),
          format: (p.format ?? "pdf") as "pdf" | "xlsx" | "csv" | "html",
          // grantedBy is the AUTHENTICATED actor of this command, never a client-supplied id.
          ...(unmaskReason ? { piiUnmask: { reason: unmaskReason, grantedBy: msg.actorId } } : {}),
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
