/**
 * inspection-service: Telemetry module — command publishing helpers.
 *
 * _Requirements: SVC-110_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface DeviceCreatePayload {
  deviceType: "sensor" | "drone" | "camera" | "iot_gateway";
  deviceIdentifier: string;
  name: string;
  entityId?: string | undefined;
  latitude?: string | undefined;
  longitude?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface DeviceUpdatePayload {
  deviceId: string;
  version: number;
  name?: string | undefined;
  entityId?: string | undefined;
  latitude?: string | undefined;
  longitude?: string | undefined;
  status?: "active" | "inactive" | "maintenance" | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ReadingIngestPayload {
  deviceId: string;
  readingType: string;
  value: string; // numeric precision as string
  unit: string;
  latitude?: string | undefined;
  longitude?: string | undefined;
  capturedAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface AlertRuleCreatePayload {
  deviceType: string;
  readingType: string;
  operator: "gt" | "lt" | "gte" | "lte" | "eq";
  thresholdValue: string; // numeric precision as string
  severity: "critical" | "major" | "minor";
}

export interface AlertAcknowledgePayload {
  alertId: string;
}

export interface AlertCreateFindingPayload {
  alertId: string;
  findingDescription?: string | undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function envelope(
  ctx: RequestContext,
  type: string,
  payload: Record<string, unknown>,
) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

// ── Publish functions ─────────────────────────────────────────────────────────

export async function publishDeviceCreate(
  payload: DeviceCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.deviceCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.deviceCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishDeviceUpdate(
  payload: DeviceUpdatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.deviceUpdate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.deviceUpdate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishReadingIngest(
  payload: ReadingIngestPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.readingIngest, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.readingIngest, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishAlertRuleCreate(
  payload: AlertRuleCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.alertRuleCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.alertRuleCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishAlertAcknowledge(
  payload: AlertAcknowledgePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.alertAcknowledge, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.alertAcknowledge, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishAlertCreateFinding(
  payload: AlertCreateFindingPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.alertCreateFinding, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.alertCreateFinding, msg);
  return { accepted: true, messageId: msg.messageId };
}
