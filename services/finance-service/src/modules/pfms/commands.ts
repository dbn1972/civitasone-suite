import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function signBatch(
  ctx: RequestContext,
  batchId: string,
  body: { reason?: string | undefined },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pfmsBatchSign, {
    messageId: id,
    type: COMMANDS.pfmsBatchSign,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: batchId, tenantId: ctx.tenantId, ...(body.reason ? { reason: body.reason } : {}) },
  });
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}

const AUDIT_TOPIC = "audit.event.record";

/**
 * GAP-FINANCE-PFMS-03: synchronous audit of a bank-file download. Route files
 * never write to the DB (t2-02 CQRS rule), so the transaction + outbox enqueue
 * live here. It is awaited by the route BEFORE the file is released: if the
 * audit write fails, this throws and the file is not sent. The payload carries
 * no account numbers.
 */
export async function recordBankFileExport(
  ctx: RequestContext,
  e: { batchId: string; pfmsId: string; reason: string; beneficiaryCount: number; ipAddress?: string | undefined; userAgent: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await enqueue(tx, {
      topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: {
        service: "finance", action: "export", resourceType: "pfms_bank_file", resourceId: e.batchId,
        outcome: "success", reason: e.reason, pfmsId: e.pfmsId, beneficiaryCount: e.beneficiaryCount,
        ipAddress: e.ipAddress,
        // audit-service stores user_agent as varchar(512); never let a long UA fail ingest
        userAgent: e.userAgent === null ? null : e.userAgent.slice(0, 512),
      },
    });
  });
}

/** Release a signed batch to PFMS: route -> command (fresh messageId) -> consumer (pfms/release.ts). */
export async function releaseBatch(ctx: RequestContext, batchId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pfmsBatchRelease, {
    messageId: id,
    type: COMMANDS.pfmsBatchRelease,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: batchId, tenantId: ctx.tenantId },
  });
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}

/** Operator decision on an ambiguous release (send_unknown): confirmed sent -> file_sent, confirmed not sent -> signed. */
export async function resolveRelease(ctx: RequestContext, batchId: string, body: { outcome: "sent" | "not_sent"; reason: string }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pfmsReleaseResolve, {
    messageId: id, type: COMMANDS.pfmsReleaseResolve, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: batchId, tenantId: ctx.tenantId, ...body },
  });
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}

/** Void a signature so a batch changed after signing can be signed again. */
export async function voidSignature(ctx: RequestContext, batchId: string, body: { reason: string }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pfmsSignatureVoid, {
    messageId: id, type: COMMANDS.pfmsSignatureVoid, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: batchId, tenantId: ctx.tenantId, ...body },
  });
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}
