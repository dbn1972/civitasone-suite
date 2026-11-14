/**
 * Producer side: the one call a module makes (inside its own write transaction) to keep global search fresh.
 * Reuses the existing `search.index.update` outbox topic, adding the optional `entityType`; the central consumer
 * (knowledge-service worker) indexes only events that carry a catalogue entityType.
 *
 * FLAG-OFF PARITY: when the tenant is not switched on this returns BEFORE building anything or touching the
 * outbox, so an unflagged tenant's transactions are byte-for-byte what they were.
 */
import { buildGlobalDocument, type GlobalSearchRecordInput } from "./contract.js";
import { isGlobalSearchEnabled } from "./flag.js";
import { GLOBAL_ENTITY_TYPES, isGlobalEntityType, type GlobalEntityType } from "./catalogue.js";
import { publishSearchIndex } from "../indexing.js";
import type { DrizzleTx } from "../indexing-types.js";

export interface PublishCtx {
  actorId: string;
  correlationId: string;
}

/** Upsert one record into global search. Returns false when the tenant has the feature off. */
export async function publishGlobalSearchRecord(tx: DrizzleTx, record: GlobalSearchRecordInput, ctx: PublishCtx): Promise<boolean> {
  if (!isGlobalSearchEnabled(record.tenantId)) return false;
  const { doc } = buildGlobalDocument(record);
  await publishSearchIndex(tx, {
    id: doc.entityId,
    tenantId: doc.tenantId,
    module: doc.module,
    entityType: doc.entityType,
    name: doc.title,
    refNumber: doc.refNumber || undefined,
    description: doc.summary || undefined,
    status: doc.status,
    action: "upsert",
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
  });
  return true;
}

/** Remove one record from global search (delete / hard purge). Returns false when the tenant has the feature off. */
export async function publishGlobalSearchRemoval(
  tx: DrizzleTx,
  rec: { entityType: GlobalEntityType; entityId: string; tenantId: string },
  ctx: PublishCtx,
): Promise<boolean> {
  if (!isGlobalSearchEnabled(rec.tenantId)) return false;
  if (!isGlobalEntityType(rec.entityType)) throw new Error(`unknown entityType: ${String(rec.entityType)}`);
  await publishSearchIndex(tx, {
    id: rec.entityId,
    tenantId: rec.tenantId,
    module: GLOBAL_ENTITY_TYPES[rec.entityType].module,
    entityType: rec.entityType,
    name: "",
    status: "deleted",
    action: "delete",
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
  });
  return true;
}
