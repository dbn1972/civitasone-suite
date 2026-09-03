// @ts-nocheck — F3 residual integration-ops consumer
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "admin-integration-ops-consumer" });

export function registerIntegrationOpsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.deadLetterRecord, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      topic: string;
      messageId?: string;
      sourceService?: string;
      correlationId?: string;
      payload?: Record<string, unknown>;
      error?: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.upsertDeadLetter(tx, {
          id: p.id,
          tenantId: p.tenantId,
          topic: p.topic,
          ...(p.messageId ? { messageId: p.messageId } : {}),
          ...(p.sourceService ? { sourceService: p.sourceService } : {}),
          ...(p.correlationId ? { correlationId: p.correlationId } : { correlationId: msg.correlationId }),
          payload: (p.payload ?? {}) as Record<string, unknown>,
          ...(p.error ? { error: p.error } : {}),
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "admin-service", action: "dead_letter_record", resourceType: "integration_ops", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deadLetterRecord failed");
      throw err;
    }
  });
}
