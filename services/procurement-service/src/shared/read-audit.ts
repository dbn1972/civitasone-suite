/**
 * Audit-on-read for sealed-bid material (GFR sealed-bid discipline).
 *
 * A GET route must not write the database, so the audit event is PUBLISHED on
 * the queue (`audit.event.record`) -- the same way the document / hrms / finance
 * read-audit routes do -- and audit-service chains it into the tenant's
 * tamper-evident log.
 *
 * The payload carries ONLY: the actor and tenant (envelope), a fixed action, the
 * route, counts and the page window. Never a bidder name, a score or any other
 * bid content: the audit trail must not become a second copy of the sealed data.
 *
 * FAIL CLOSED: if the publish throws, this throws, the route answers 5xx and NO
 * bid data is released. Callers must `await auditRead(...)` BEFORE replying.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "./infra.js";
import { HttpError } from "./context.js";

export const AUDIT_TOPIC = "audit.event.record";

export type ReadAuditEvent = {
  action: string;
  resourceType: string;
  route: string;
  resultCount: number;
  /** Non-sensitive scalars only (page window, totals, how many rows carried an opened envelope). */
  details?: Record<string, string | number | boolean>;
};

export async function auditRead(
  ctx: Pick<RequestContext, "tenantId" | "actorId" | "correlationId">,
  event: ReadAuditEvent,
): Promise<void> {
  const messageId = randomUUID();
  try {
    await queue.publish(AUDIT_TOPIC, {
      messageId,
      type: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        service: "procurement",
        action: event.action,
        resourceType: event.resourceType,
        // A register read has no single resource: a fresh id identifies this read.
        resourceId: messageId,
        outcome: "success",
        details: { route: event.route, resultCount: event.resultCount, ...(event.details ?? {}) },
      },
    });
  } catch {
    // Fail closed with a fixed message: the queue's own error text must not reach the caller.
    throw new HttpError(503, "AUDIT_UNAVAILABLE", "This read could not be recorded, so nothing was returned. Try again shortly.");
  }
}
