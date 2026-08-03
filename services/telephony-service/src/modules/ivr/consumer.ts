import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { IvrHitInsert } from "./schema.js";

const log = pino({ name: "telephony-ivr-consumer" });
const AUDIT = "audit.event.record";

export function registerIvrConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.batchIvrHits, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; callId: string;
      rows: Array<IvrHitInsert & { timestamp: string | Date }>;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows: IvrHitInsert[] = p.rows.map((r) => ({
          ...r,
          timestamp: r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp),
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
