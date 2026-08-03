/**
 * visitor-service: device-registry command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern, per
 * structure.md). Each function publishes a command envelope to SQS/RabbitMQ;
 * the consumer (./consumer.ts) performs the durable write + outbox event.
 *
 * Requirements validated: 1.1, 1.8, 1.10, 2.4, 8.2, 8.6, 8.7, 10.2
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── Payload input types ───────────────────────────────────────────────────

export interface DeviceRegisterInput {
  deviceType: string;
  name: string;
  serialNumber: string;
  locationId: string;
  gateId?: string | null;
  capabilities?: Record<string, string[]>;
}

export interface DeviceActivateInput {
  deviceId: string;
}

export interface DeviceSuspendInput {
  deviceId: string;
  reason?: string;
}

export interface DeviceDeregisterInput {
  deviceId: string;
  reason?: string;
}

export interface DeviceRotateCredentialInput {
  deviceId: string;
}

export interface DeviceConfigPushInput {
  deviceId: string;
  config: Record<string, unknown>;
}

export interface DeviceBulkConfigPushInput {
  deviceType: string;
  locationId: string;
  config: Record<string, unknown>;
}

export interface DeviceFirmwareScheduleInput {
  deviceId: string;
  firmwareUrl: string;
  firmwareChecksum: string;
}

// ── Command publishers ────────────────────────────────────────────────────

/**
 * Register a new device. Mints the device id client-side so the caller
 * gets the id in the 202 response before the consumer processes it.
 */
export async function publishDeviceRegister(ctx: RequestContext, input: DeviceRegisterInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.deviceRegister, {
    messageId: id,
    type: COMMANDS.deviceRegister,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      deviceType: input.deviceType,
      name: input.name,
      serialNumber: input.serialNumber,
      locationId: input.locationId,
      gateId: input.gateId ?? null,
      capabilities: input.capabilities ?? {},
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Activate a device (pending_activation → active). */
export async function publishDeviceActivate(ctx: RequestContext, input: DeviceActivateInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceActivate, {
    messageId,
    type: COMMANDS.deviceActivate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { deviceId: input.deviceId, tenantId: ctx.tenantId },
  });
  return { id: input.deviceId, status: "accepted", correlationId: ctx.correlationId };
}

/** Suspend a device (active → suspended). */
export async function publishDeviceSuspend(ctx: RequestContext, input: DeviceSuspendInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceSuspend, {
    messageId,
    type: COMMANDS.deviceSuspend,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
      reason: input.reason ?? null,
    },
  });
  return { id: input.deviceId, status: "accepted", correlationId: ctx.correlationId };
}

/** Deregister a device (active/suspended → deregistered). */
export async function publishDeviceDeregister(ctx: RequestContext, input: DeviceDeregisterInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceDeregister, {
    messageId,
    type: COMMANDS.deviceDeregister,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
      reason: input.reason ?? null,
    },
  });
  return { id: input.deviceId, status: "accepted", correlationId: ctx.correlationId };
}

/** Rotate device credentials (generate new token, keep old in grace period). */
export async function publishDeviceRotateCredential(ctx: RequestContext, input: DeviceRotateCredentialInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceRotateCredential, {
    messageId,
    type: COMMANDS.deviceRotateCredential,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { deviceId: input.deviceId, tenantId: ctx.tenantId },
  });
  return { id: input.deviceId, status: "accepted", correlationId: ctx.correlationId };
}

/** Push configuration to a single device. */
export async function publishDeviceConfigPush(ctx: RequestContext, input: DeviceConfigPushInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceConfigPush, {
    messageId,
    type: COMMANDS.deviceConfigPush,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
      config: input.config,
    },
  });
  return { id: input.deviceId, status: "accepted", correlationId: ctx.correlationId };
}

/** Push configuration to multiple devices matching type + location. */
export async function publishDeviceBulkConfigPush(ctx: RequestContext, input: DeviceBulkConfigPushInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceBulkConfigPush, {
    messageId,
    type: COMMANDS.deviceBulkConfigPush,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      tenantId: ctx.tenantId,
      deviceType: input.deviceType,
      locationId: input.locationId,
      config: input.config,
    },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/** Schedule a firmware update for a device (delivered via next heartbeat). */
export async function publishDeviceFirmwareSchedule(ctx: RequestContext, input: DeviceFirmwareScheduleInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceFirmwareSchedule, {
    messageId,
    type: COMMANDS.deviceFirmwareSchedule,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
      firmwareUrl: input.firmwareUrl,
      firmwareChecksum: input.firmwareChecksum,
    },
  });
  return { id: input.deviceId, status: "accepted", correlationId: ctx.correlationId };
}

export interface DeviceHeartbeatInput {
  deviceId: string;
  tenantId: string;
  firmwareVersion: string;
  lastSeenAt: string;
}

/** Durable heartbeat write (Redis online TTL stays sync on the route). */
export async function publishDeviceHeartbeat(
  input: DeviceHeartbeatInput,
  opts: { actorId: string; correlationId: string },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deviceHeartbeat, {
    messageId,
    type: COMMANDS.deviceHeartbeat,
    tenantId: input.tenantId,
    actorId: opts.actorId,
    correlationId: opts.correlationId,
    schemaVersion: "1.0",
    payload: {
      deviceId: input.deviceId,
      tenantId: input.tenantId,
      firmwareVersion: input.firmwareVersion,
      lastSeenAt: input.lastSeenAt,
    },
  });
  return { id: input.deviceId, status: "accepted", correlationId: opts.correlationId };
}
