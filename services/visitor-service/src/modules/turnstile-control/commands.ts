/**
 * visitor-service: turnstile-control command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 * Each function publishes a command envelope to SQS/RabbitMQ; the consumer
 * (./consumer.ts) performs the durable write + outbox event.
 *
 * Requirements validated: 7.1–7.10, 9.1–9.8, 11.1, 11.3
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── Payload input types ───────────────────────────────────────────────────

export interface PassageRecordInput {
  passId: string;
  gateId: string;
  direction: "in" | "out";
  passageCount: number;
  eventTimestamp: string;
  offlineRecorded: boolean;
}

export interface EmergencyUnlockInput {
  locationId: string;
  reason: string;
}

export interface EmergencyRestoreInput {
  locationId: string;
}

export interface OfflineSyncInput {
  deviceId: string;
  events: Array<{
    passId: string;
    gateId: string;
    direction: "in" | "out";
    passageCount: number;
    eventTimestamp: string;
    offlineRecorded: boolean;
  }>;
}

// ── Command publishers ────────────────────────────────────────────────────

/** Publish a turnstile open command (for passage confirmation). */
export async function publishTurnstileOpen(ctx: RequestContext, input: { deviceId: string; passId: string }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.turnstileOpen, {
    messageId: id,
    type: COMMANDS.turnstileOpen,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, deviceId: input.deviceId, passId: input.passId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish a turnstile close command. */
export async function publishTurnstileClose(ctx: RequestContext, input: { deviceId: string }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.turnstileClose, {
    messageId: id,
    type: COMMANDS.turnstileClose,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, deviceId: input.deviceId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish an emergency unlock command for all devices at a location. */
export async function publishEmergencyUnlock(ctx: RequestContext, input: EmergencyUnlockInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.emergencyUnlock, {
    messageId: id,
    type: COMMANDS.emergencyUnlock,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, locationId: input.locationId, reason: input.reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish an emergency restore command to return to normal operation. */
export async function publishEmergencyRestore(ctx: RequestContext, input: EmergencyRestoreInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.emergencyRestore, {
    messageId: id,
    type: COMMANDS.emergencyRestore,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, locationId: input.locationId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish a passage record command (turnstile reports a passage event). */
export async function publishPassageRecord(ctx: RequestContext, input: PassageRecordInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.passageRecord, {
    messageId: id,
    type: COMMANDS.passageRecord,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      passId: input.passId,
      gateId: input.gateId,
      direction: input.direction,
      passageCount: input.passageCount,
      eventTimestamp: input.eventTimestamp,
      offlineRecorded: input.offlineRecorded,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish an offline sync command (batch of offline-queued events). */
export async function publishOfflineSync(ctx: RequestContext, input: OfflineSyncInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.offlineSync, {
    messageId: id,
    type: COMMANDS.offlineSync,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      deviceId: input.deviceId,
      events: input.events,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
