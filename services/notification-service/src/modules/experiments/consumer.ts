/**
 * CR-MKT-05 — experiment writes.
 *
 * DLQ safety: an invalid variant set, an unknown experiment/variant, or a bad
 * timestamp can never succeed on retry, so all are NonRetryableError.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import {
  validateVariants,
  summariseVariants,
  determineWinner,
  type VariantDef,
  type EngagementEvent,
} from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "consumer:experiments" });

type CreatePayload = {
  id: string; tenantId: string; name: string;
  variants: Array<{ id: string; key: string; allocationPct: number; templateId?: string }>;
};

type EventPayload = {
  id: string; tenantId: string; experimentId: string; variantId: string;
  eventType: "open" | "click"; deliveryId?: string;
  linkPosition?: number; linkUrl?: string; occurredAt?: string;
};

export function registerExperimentConsumers(q: Queue): void {
  q = tenantScoped(q);

  q.subscribe<CreatePayload>(COMMANDS.createExperiment, async (msg) => {
    const p = msg.payload;
    const defs: VariantDef[] = p.variants.map((v) => ({
      id: v.id, key: v.key, allocationPct: v.allocationPct,
    }));
    const invalid = validateVariants(defs);
    if (invalid) throw new NonRetryableError(`${invalid.code}: ${invalid.message}`);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertExperiment(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, status: "running",
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await repo.insertVariants(tx, p.variants.map((v) => ({
        id: v.id,
        tenantId: p.tenantId,
        experimentId: p.id,
        variantKey: v.key,
        allocationPct: v.allocationPct,
        templateId: v.templateId ?? null,
        sentCount: 0,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      })));
      await enqueue(tx, {
        topic: EVENTS.experimentCreated,
        eventType: EVENTS.experimentCreated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { experimentId: p.id, name: p.name, variantIds: p.variants.map((v) => v.id) },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "create_experiment", resourceType: "experiment",
          resourceId: p.id, outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "experiment", p.id));
    log.info({ experimentId: p.id }, "experiment created");
  });

  q.subscribe<EventPayload>(COMMANDS.recordExperimentEvent, async (msg) => {
    const p = msg.payload;
    if (p.eventType !== "open" && p.eventType !== "click") {
      throw new NonRetryableError("INVALID_EVENT_TYPE: eventType must be open or click");
    }
    let occurredAt = new Date();
    if (p.occurredAt !== undefined) {
      const parsed = new Date(p.occurredAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new NonRetryableError("INVALID_EVENT_PAYLOAD: occurredAt must be an ISO-8601 timestamp");
      }
      occurredAt = parsed;
    }

    let missing: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const variant = await repo.findVariantInTx(tx, p.tenantId, p.experimentId, p.variantId);
      if (!variant) {
        missing = `variant ${p.variantId} not found in experiment ${p.experimentId}`;
        return;
      }
      await repo.insertEvent(tx, {
        id: p.id,
        tenantId: p.tenantId,
        experimentId: p.experimentId,
        variantId: p.variantId,
        deliveryId: p.deliveryId ?? null,
        eventType: p.eventType,
        linkPosition: p.linkPosition ?? null,
        linkUrl: p.linkUrl ?? null,
        occurredAt,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.experimentEventRecorded,
        eventType: EVENTS.experimentEventRecorded,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          experimentId: p.experimentId, variantId: p.variantId,
          eventType: p.eventType, linkPosition: p.linkPosition ?? null,
        },
      });
    });
    if (missing !== null) throw new NonRetryableError(`VARIANT_NOT_FOUND: ${missing}`);
    await cache.invalidate(cache.makeKey(p.tenantId, "experiment_results", p.experimentId));
  });

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.requestWinnerApproval, async (msg) => {
    const p = msg.payload;
    let missing = false;
    let badStatus: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const experiment = await repo.findExperimentInTx(tx, p.tenantId, p.id);
      if (!experiment) { missing = true; return; }
      if (experiment.status !== "running" && experiment.status !== "draft") {
        badStatus = experiment.status;
        return;
      }
      await repo.setStatus(tx, p.tenantId, p.id, "pending_approval", msg.actorId, experiment.version);
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "request_winner_approval", resourceType: "experiment",
          resourceId: p.id, outcome: "success",
        },
      });
    });
    if (missing) throw new NonRetryableError(`EXPERIMENT_NOT_FOUND: experiment ${p.id} not found`);
    if (badStatus) throw new NonRetryableError(`INVALID_STATUS: ${badStatus}`);
    await cache.invalidate(cache.makeKey(p.tenantId, "experiment", p.id));
  });

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.concludeExperiment, async (msg) => {
    const p = msg.payload;
    let missing = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const experiment = await repo.findExperimentInTx(tx, p.tenantId, p.id);
      if (!experiment) {
        missing = true;
        return;
      }
      // P2-9: winner promotion is approval-gated — conclude only after pending_approval.
      if (experiment.status !== "pending_approval") {
        missing = true;
        return;
      }
      const mine = await repo.listVariantsInTx(tx, p.tenantId, p.id);
      const events = await repo.listEventsInTx(tx, p.tenantId, p.id);
      const myEvents: EngagementEvent[] = events.map((e) => ({
        variantId: e.variantId,
        eventType: e.eventType === "click" ? "click" : "open",
        linkPosition: e.linkPosition,
      }));
      const defs: VariantDef[] = mine.map((v) => ({
        id: v.id, key: v.variantKey, allocationPct: v.allocationPct,
      }));
      const sentByVariant: Record<string, number> = {};
      for (const v of mine) sentByVariant[v.id] = v.sentCount;
      const verdict = determineWinner(summariseVariants(defs, sentByVariant, myEvents));

      await repo.setWinner(
        tx, p.tenantId, p.id,
        verdict.decided ? verdict.variantId : null,
        verdict.decided ? Math.round(verdict.marginPct) : null,
        msg.actorId, experiment.version,
      );
      await enqueue(tx, {
        topic: EVENTS.experimentConcluded,
        eventType: EVENTS.experimentConcluded,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          experimentId: p.id,
          decided: verdict.decided,
          winnerVariantId: verdict.decided ? verdict.variantId : null,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "conclude_experiment", resourceType: "experiment",
          resourceId: p.id, outcome: "success", decided: verdict.decided,
        },
      });
    });
    if (missing) throw new NonRetryableError(`EXPERIMENT_NOT_FOUND: experiment ${p.id} not found`);
    await cache.invalidate(cache.makeKey(p.tenantId, "experiment", p.id));
  });
}
