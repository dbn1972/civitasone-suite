import type { ScopedTx } from "./db.js";
import { enqueue } from "./outbox.js";
import { SERVICE } from "../topics.js";

export interface AuditCtx {
  tenantId: string;
  actorId: string;
  correlationId: string;
}

export interface AuditPayload {
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}

export async function writeAudit(
  tx: ScopedTx,
  ctx: AuditCtx,
  payload: AuditPayload,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    tenantId: ctx.tenantId,
    payload: {
      service: SERVICE,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      outcome: "success",
      ...payload,
    },
  });
}
