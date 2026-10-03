import type { RequestContext } from "@civitasone/types";
import { enqueue } from "./outbox.js";

type Tx = Parameters<typeof enqueue>[0];

/**
 * Append an `audit.event.record` outbox row inside the caller's open
 * transaction, so the business write and its audit trail commit or roll back
 * together. Never put secrets or full PII in `details` (reveal events carry the
 * field NAMES and the reason, never the values).
 */
export async function recordAudit(
  tx: Tx,
  ctx: Pick<RequestContext, "tenantId" | "actorId" | "correlationId">,
  e: {
    action: string;
    resourceType: string;
    resourceId: string;
    outcome?: "success" | "denied" | "failure";
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: {
      service: "finance",
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      outcome: e.outcome ?? "success",
      ...(e.details ? { details: e.details } : {}),
    },
  });
}
