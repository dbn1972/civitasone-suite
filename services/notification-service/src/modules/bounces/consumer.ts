/**
 * INT-12 — bounce recording + suppression maintenance.
 *
 * DLQ safety: payload-shape problems (missing recipient, unparseable
 * occurredAt, unknown suppression id) are thrown as NonRetryableError so the
 * message goes straight to the DLQ instead of being retried forever. Only
 * genuine infrastructure failures (DB down) are left to the retry path.
 *
 * NonRetryableError's signature is (message, cause) — the second parameter is
 * NOT a message. Passing ("CODE", "detail") puts the code in err.message and
 * buries the detail in cause, so the DLQ record ends up with a bare code and no
 * diagnostic. The code is therefore prefixed into the single message string:
 * "CODE: detail" stays greppable AND reaches the DLQ intact. Do not split it
 * back into two arguments.
 *
 * PII: the recipient never reaches a log line. Only entity ids are logged.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { blindIndex } from "../../shared/pii-crypto.js";
import { classifyBounce, decideSuppression, resolveSoftBounceThreshold } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "consumer:bounces" });

type RecordBouncePayload = {
  id: string;
  tenantId: string;
  recipient: string;
  deliveryId?: string;
  channel?: string;
  smtpCode?: string;
  reason?: string;
  occurredAt?: string;
};

export function registerBounceConsumers(q: Queue): void {
  // RLS (#146): handlers run outside an HTTP request, so the tenant context has
  // to come from the message — tables are FORCE RLS.
  q = tenantScoped(q);

  q.subscribe<RecordBouncePayload>(COMMANDS.recordBounce, async (msg) => {
    const p = msg.payload;
    if (typeof p.recipient !== "string" || p.recipient.trim().length === 0) {
      throw new NonRetryableError("INVALID_BOUNCE_PAYLOAD: recipient is required");
    }
    let occurredAt = new Date();
    if (p.occurredAt !== undefined) {
      const parsed = new Date(p.occurredAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new NonRetryableError("INVALID_BOUNCE_PAYLOAD: occurredAt must be an ISO-8601 timestamp");
      }
      occurredAt = parsed;
    }

    const classification = classifyBounce({ smtpCode: p.smtpCode, reason: p.reason });
    const recipientHash = blindIndex(p.recipient);
    const channel = p.channel ?? "email";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.insertBounceEvent(tx, {
        id: p.id,
        tenantId: p.tenantId,
        deliveryId: p.deliveryId ?? null,
        recipient: p.recipient,
        recipientHash,
        channel,
        smtpCode: p.smtpCode ?? null,
        reason: p.reason ?? null,
        classification,
        occurredAt,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      const softCount = classification === "soft"
        ? await repo.countSoftBounces(tx, p.tenantId, recipientHash)
        : 0;
      const threshold = resolveSoftBounceThreshold(await repo.findThresholdSetting(tx, p.tenantId));
      const decision = decideSuppression(classification, softCount, threshold);

      if (decision.suppress) {
        await repo.upsertSuppression(tx, {
          tenantId: p.tenantId,
          recipient: p.recipient,
          recipientHash,
          channel,
          reason: decision.reason,
          source: "bounce",
          softBounceCount: softCount,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await enqueue(tx, {
          topic: EVENTS.recipientSuppressed,
          eventType: EVENTS.recipientSuppressed,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { bounceEventId: p.id, recipientHash, channel, reason: decision.reason, softBounceCount: softCount },
        });
      }

      await enqueue(tx, {
        topic: EVENTS.bounceRecorded,
        eventType: EVENTS.bounceRecorded,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          bounceEventId: p.id, deliveryId: p.deliveryId ?? null, channel,
          classification, suppressed: decision.suppress,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "record_bounce", resourceType: "bounce_event",
          resourceId: p.id, outcome: "success", classification, suppressed: decision.suppress,
        },
      });
    });

    await cache.invalidate(cache.makeKey(p.tenantId, "suppression", recipientHash));
    log.info({ bounceEventId: p.id, classification }, "bounce recorded");
  });

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.releaseSuppression, async (msg) => {
    const p = msg.payload;
    // "duplicate" (already processed) must NOT be treated as "missing" — a
    // redelivered message would otherwise be dead-lettered spuriously.
    // The outcome is RETURNED from the transaction rather than assigned to an
    // outer `let`. TypeScript's control-flow analysis cannot see an assignment
    // made inside an async callback, so it kept the variable narrowed to its
    // initialiser and the `=== "missing"` check below failed to compile.
    const outcome = await db.transaction(async (tx): Promise<"duplicate" | "released" | "missing"> => {
      if (!(await markProcessed(tx, msg.messageId))) return "duplicate";
      const released = await repo.releaseSuppression(tx, p.tenantId, p.id, msg.actorId);
      if (!released) return "missing";
      await enqueue(tx, {
        topic: EVENTS.suppressionReleased,
        eventType: EVENTS.suppressionReleased,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { suppressionId: p.id },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "release_suppression", resourceType: "suppression",
          resourceId: p.id, outcome: "success",
        },
      });
      return "released";
    });
    if (outcome === "missing") {
      // A release for an id that does not exist will never succeed on retry.
      throw new NonRetryableError(`SUPPRESSION_NOT_FOUND: suppression ${p.id} not found`);
    }
  });
}
