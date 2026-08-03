/**
 * ivr consumer — the ONLY code that writes `telephony.ivr_hits`.
 *
 * Ordinals and the per-call hit cap are decided HERE, inside the write
 * transaction. The route's pre-check reads committed state, so two batches
 * accepted before either had applied would both have been numbered from the
 * same base — producing duplicate ordinals and letting the 50-hit cap be
 * exceeded. Re-reading in the transaction that inserts removes that window;
 * the unique index on (tenant_id, call_id, ordinal) added in migration 0015
 * closes it entirely by making a colliding batch roll back and retry.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { MAX_IVR_HITS_PER_CALL } from "./domain.js";
import { batchIvrHitsPayload } from "./validators.js";
import type { IvrHitInsert } from "./schema.js";

const log = pino({ name: "telephony-ivr-consumer" });
const AUDIT = "audit.event.record";

export function registerIvrConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.batchIvrHits, async (msg) => {
    const parsed = batchIvrHitsPayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid batchIvrHits payload: ${parsed.error.message}`);
    const p = parsed.data;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const currentCount = await repo.countByCall(p.tenantId, p.callId, tx);
        if (currentCount + p.hits.length > MAX_IVR_HITS_PER_CALL) {
          await emitAudit(tx, msg, p.callId, "rejected_limit_exceeded");
          return;
        }

        const startOrdinal = await repo.maxOrdinal(p.tenantId, p.callId, tx);
        const rows: IvrHitInsert[] = p.hits.map((hit, idx) => ({
          id: randomUUID(),
          tenantId: p.tenantId,
          callId: p.callId,
          menuKey: hit.menuKey,
          digit: hit.digit,
          timestamp: new Date(hit.timestamp),
          ordinal: startOrdinal + idx + 1,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        }));
        await repo.insertBatch(tx as unknown as typeof db, rows);

        await enqueue(tx, {
          topic: EVENTS.callIvrRecorded,
          eventType: EVENTS.callIvrRecorded,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { callId: p.callId, inserted: rows.length },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "telephony", action: "ivr_batch_insert", resourceType: "call", resourceId: p.callId, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "batchIvrHits failed");
      throw err;
    }
  });
}

/** Audit-only emit for a rejected batch (no domain event, no throw). */
async function emitAudit(
  tx: Parameters<typeof enqueue>[0],
  msg: CommandEnvelope,
  callId: string,
  outcome: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "telephony", action: "ivr_batch_insert", resourceType: "call", resourceId: callId, outcome },
  });
}
