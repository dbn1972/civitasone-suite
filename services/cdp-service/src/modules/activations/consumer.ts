/**
 * activations/consumer.ts — CDP-012 handler for cdp.segment.activate.
 * Inserts the pending/completed run and emits dispatch when schedule allows.
 */
import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { z } from "zod";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { ACTIVATION_CHANNELS, isImmediate } from "./domain.js";

const log = pino({ name: "cdp.activations.consumer" });

const payloadSchema = z.object({
  activationId: z.string().uuid(),
  segmentId: z.string().uuid(),
  channel: z.enum(ACTIVATION_CHANNELS),
  audienceCount: z.number().int().min(0).default(0),
  dispatchAt: z.string().datetime().optional(),
});

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export async function handleActivateSegment(msg: CommandEnvelope<unknown>): Promise<void> {
  const parsed = payloadSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn({ messageId: msg.messageId, outcome: "skipped_invalid_payload" }, "activation payload rejected");
    return;
  }
  const p = parsed.data;
  const now = new Date();
  const dispatchAt = p.dispatchAt ? new Date(p.dispatchAt) : now;
  const immediate = isImmediate(dispatchAt, now);

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    await repo.insert(tx, {
      id: p.activationId,
      tenantId: msg.tenantId,
      segmentId: p.segmentId,
      channel: p.channel,
      status: immediate ? "completed" : "pending",
      audienceCount: p.audienceCount,
      ...(immediate ? { startedAt: now, completedAt: now } : {}),
    });

    await enqueue(tx, {
      topic: EVENTS.activationRequested,
      eventType: EVENTS.activationRequested,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        activationId: p.activationId,
        segmentId: p.segmentId,
        channel: p.channel,
        status: immediate ? "completed" : "pending",
        audienceCount: p.audienceCount,
        dispatchAt: dispatchAt.toISOString(),
      },
    });

    if (immediate) {
      await enqueue(tx, {
        topic: EVENTS.activationDispatched,
        eventType: EVENTS.activationDispatched,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          activationId: p.activationId,
          segmentId: p.segmentId,
          channel: p.channel,
          audienceCount: p.audienceCount,
          dispatchedAt: now.toISOString(),
        },
      });
    }

    await writeAudit(tx, ctxOf(msg), {
      action: immediate ? "activation_dispatched" : "segment_activated",
      resourceType: "activation",
      resourceId: p.activationId,
      details: { segmentId: p.segmentId, channel: p.channel, audienceCount: p.audienceCount },
    });
  });

  log.info({ activationId: p.activationId, immediate }, "activation handled");
}

export function registerActivationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.activateSegment, handleActivateSegment);
}
