/**
 * FN-08 — Pack notification bindings (runtime send path).
 *
 * Designer B8 persists `{ kind: "notifications", bindings: [...] }` into
 * catalogue `service_definitions.outputs` and upserts notification-service
 * templates. This module resolves those bindings on lifecycle events and
 * enqueues `notification.send` with the pack template UUID + channel.
 */
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import type { NotificationSendPayload } from "@civitasone/events";
import { enqueue } from "../../shared/outbox.js";
import * as catalogueRepo from "./repo.js";

export const PACK_NOTIFICATION_EVENTS = [
  "submitted",
  "approved",
  "rejected",
  "payment_due",
  "payment_received",
  "issued",
  "inspection_scheduled",
] as const;

export type PackNotificationEvent = (typeof PACK_NOTIFICATION_EVENTS)[number];

export const PACK_NOTIFICATION_CHANNELS = ["sms", "email", "whatsapp", "in_app"] as const;
export type PackNotificationChannel = (typeof PACK_NOTIFICATION_CHANNELS)[number];

export interface PackNotificationBinding {
  event: PackNotificationEvent;
  channel: PackNotificationChannel;
  templateId?: string;
  templateName?: string;
  enabled: boolean;
}

export interface PackNotificationsConfig {
  kind: "notifications";
  bindings: PackNotificationBinding[];
}

const EVENT_SET = new Set<string>(PACK_NOTIFICATION_EVENTS);
const CHANNEL_SET = new Set<string>(PACK_NOTIFICATION_CHANNELS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function extractNotificationBindings(outputs: unknown[] | null | undefined): PackNotificationBinding[] {
  if (!Array.isArray(outputs)) return [];
  const cfg = outputs.find(
    (o): o is PackNotificationsConfig =>
      isRecord(o) && o.kind === "notifications" && Array.isArray(o.bindings),
  );
  if (!cfg) return [];

  const out: PackNotificationBinding[] = [];
  for (const raw of cfg.bindings) {
    if (!isRecord(raw)) continue;
    if (raw.enabled === false) continue;
    const event = String(raw.event ?? "");
    const channel = String(raw.channel ?? "");
    if (!EVENT_SET.has(event) || !CHANNEL_SET.has(channel)) continue;
    const templateId = typeof raw.templateId === "string" && raw.templateId.length > 0
      ? raw.templateId
      : undefined;
    // Runtime send requires a persisted notification-service template UUID.
    if (!templateId) continue;
    out.push({
      event: event as PackNotificationEvent,
      channel: channel as PackNotificationChannel,
      templateId,
      templateName: typeof raw.templateName === "string" ? raw.templateName : undefined,
      enabled: true,
    });
  }
  return out;
}

export function bindingsForEvent(
  outputs: unknown[] | null | undefined,
  event: PackNotificationEvent,
): PackNotificationBinding[] {
  return extractNotificationBindings(outputs).filter((b) => b.event === event);
}

/** Format paise → major units for {{amount}} merge fields (e.g. 50000 → "500.00"). */
export function formatAmountMajor(amountPaise: number, currency = "INR"): string {
  const major = Math.trunc(amountPaise) / 100;
  if (currency === "INR" || currency === "USD" || currency === "EUR") {
    return major.toFixed(2);
  }
  return String(major);
}

export type EnqueueWriter = Parameters<typeof enqueue>[0];

export interface EnqueuePackNotificationsArgs {
  tenantId: string;
  actorId: string;
  correlationId: string;
  serviceId: string;
  lifecycleEvent: PackNotificationEvent;
  recipient: string;
  recipientId?: string;
  variables?: Record<string, string>;
  /** Domain eventType stamped on the send payload (for prefs / audit). */
  eventType?: string;
}

/**
 * Load published pack outputs for `serviceId` and enqueue one `notification.send`
 * per enabled binding for `lifecycleEvent`. Returns the number of sends enqueued.
 */
export async function enqueuePackNotifications(
  tx: EnqueueWriter,
  args: EnqueuePackNotificationsArgs,
): Promise<number> {
  const def = await catalogueRepo.findPublishedByServiceIdTx(tx as never, args.tenantId, args.serviceId);
  if (!def) return 0;
  const bindings = bindingsForEvent(def.outputs as unknown[], args.lifecycleEvent);
  if (bindings.length === 0) return 0;

  const eventType = args.eventType ?? `citizen.pack.notification.${args.lifecycleEvent}`;
  const baseVars: Record<string, string> = {
    service_name: def.name,
    service_key: def.serviceKey,
    ...(args.variables ?? {}),
  };

  let count = 0;
  for (const b of bindings) {
    const payload: NotificationSendPayload = buildNotificationPayload({
      eventType,
      recipient: args.recipient,
      recipientId: args.recipientId,
      channel: b.channel,
      templateId: b.templateId,
      variables: baseVars,
    });
    await enqueue(tx, {
      topic: NOTIFICATION_SEND,
      eventType: NOTIFICATION_SEND,
      tenantId: args.tenantId,
      actorId: args.actorId,
      correlationId: args.correlationId,
      payload,
    });
    count += 1;
  }
  return count;
}
