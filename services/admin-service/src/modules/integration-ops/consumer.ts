// @ts-nocheck — F3 residual integration-ops consumer
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

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
          tenantId: p.tenantId,
          topic: p.topic,
          ...(p.messageId ? { messageId: p.messageId } : {}),
          ...(p.sourceService ? { sourceService: p.sourceService } : {}),
          ...(p.correlationId ? { correlationId: p.correlationId } : { correlationId: msg.correlationId }),
          payload: (p.payload ?? {}) as Record<string, unknown>,
          ...(p.error ? { error: p.error } : {}),
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deadLetterRecord failed");
      throw err;
    }
  });
}
