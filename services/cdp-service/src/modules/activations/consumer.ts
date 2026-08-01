/**
 * activations/consumer.ts — CDP-012 handler for cdp.segment.activate.
 *
 * POST /v1/cdp/segments/:id/activate records the run as `pending` synchronously so the
 * caller gets an id it can poll. Actually handing the audience to the channel is the
 * asynchronous half, and it is what this handler does: it advances the run out of
 * `pending` and emits the per-channel dispatch instruction.
 *
 * `completed` here means "handed to the channel", not "delivered to every recipient" —
 * CDP does not own channel delivery and has no callback from it. The intermediate
 * `running` state is not persisted separately because that would need a second
 * transaction (one handler = one transaction) and no reader could ever observe it.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { z } from "zod";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { ACTIVATION_CHANNELS } from "./domain.js";

const log = pino({ name: "cdp-activations-consumer", level: process.env.LOG_LEVEL ?? "info" });

const AUDIT_TOPIC = "audit.event.record";

const payloadSchema = z.object({
  activationId: z.string().uuid(),
  segmentId: z.string().uuid(),
  channel: z.enum(ACTIVATION_CHANNELS),
  audienceCount: z.number().int().min(0).default(0),
  dispatchAt: z.string().datetime().optional(),
});

export type ActivateSegmentPayload = z.infer<typeof payloadSchema>;

export async function handleActivateSegment(msg: CommandEnvelope<unknown>): Promise<void> {
  const parsed = payloadSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, outcome: "skipped_invalid_payload", issues: parsed.error.issues.map((i) => i.path.join(".")) },
      "activation payload rejected",
    );
    return;
  }
  const p = parsed.data;

  const run = await repo.findById(p.activationId, msg.tenantId);
  if (!run) {
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, activationId: p.activationId, outcome: "skipped_unknown_activation" },
      "activation not found",
    );
    return;
  }
  // Only a pending run may be dispatched. `running`/`completed`/`failed` are already past
  // this point, and re-dispatching would send the same audience twice.
  if (run.status !== "pending") {
    log.info(
      { messageId: msg.messageId, tenantId: msg.tenantId, activationId: p.activationId, status: run.status, outcome: "skipped_not_pending" },
      "activation already past dispatch",
    );
    return;
  }

  const now = new Date();
  // A future dispatch time is honoured: the run stays pending for a scheduled sweep
  // rather than being sent early. See the report note — no such sweep exists yet, so a
  // future-dated activation currently waits for an operator.
  if (p.dispatchAt !== undefined && new Date(p.dispatchAt).getTime() > now.getTime()) {
    log.info(
      { messageId: msg.messageId, tenantId: msg.tenantId, activationId: p.activationId, outcome: "deferred" },
      "activation dispatch deferred to its schedule",
    );
    return;
  }

  let dispatched = false;

  await db.transaction(async (tx) => {
    // Idempotency gate — first statement. A redelivery must not emit a second dispatch
    // instruction for the same run.
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return;

    const ok = await repo.updateStatus(tx, p.activationId, msg.tenantId, run.version, {
      status: "completed",
      // The route stamps startedAt for an immediate run; a run that reaches the channel
      // without one gets it here, so a dispatched run always has a start time.
      startedAt: run.startedAt ?? now,
      completedAt: now,
    });
    if (!ok) {
      // Someone else advanced the run between the read and the update. Retrying is
      // pointless (the message is already marked processed and the run is no longer
      // pending), so this is a logged no-op rather than a throw.
      return;
    }

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
        // The run row's snapshot wins over the command payload: it is what the audience
        // refresh (cdp.segment.compute) keeps current.
        audienceCount: run.audienceCount,
        dispatchedAt: now.toISOString(),
      },
    });

    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        service: "cdp",
        action: "activation_dispatched",
        resourceType: "activation",
        resourceId: p.activationId,
        outcome: "success",
        metadata: { segmentId: p.segmentId, channel: p.channel, audienceCount: run.audienceCount },
      },
    });

    dispatched = true;
  });

  log.info(
    {
      messageId: msg.messageId,
      tenantId: msg.tenantId,
      activationId: p.activationId,
      channel: p.channel,
      outcome: dispatched ? "processed" : "skipped_conflict_or_duplicate",
    },
    "activation dispatch handled",
  );
}
