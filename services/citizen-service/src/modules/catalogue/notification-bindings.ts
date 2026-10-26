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
import { and, eq } from "drizzle-orm";
import { enqueue } from "../../shared/outbox.js";
import { citizenProfiles } from "../portal/schema.js";
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
      // exactOptionalPropertyTypes: omit the key entirely rather than setting
      // it to undefined, which is not assignable to `templateName?: string`.
      ...(typeof raw.templateName === "string" ? { templateName: raw.templateName } : {}),
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProfileReader = {
  select: (fields: Record<string, unknown>) => {
    from: (t: unknown) => { where: (w: unknown) => { limit: (n: number) => Promise<Array<{ email: string | null; mobile: string | null }>> } };
  };
};

/**
 * V4-G-06: notification-service passes `recipient` verbatim to the SMTP/SMS/
 * WhatsApp adapters as the destination address, so a citizen profile UUID in
 * that slot can never be delivered. Resolve the real address from the citizen
 * profile (decrypted on read) for the channel:
 *   email -> profile.email; sms / whatsapp -> profile.mobile; in_app -> the id.
 * Returns null when the citizen has no address for the channel (caller skips
 * the send rather than addressing a UUID). An id that is not a UUID cannot be a
 * profile id and is returned unchanged (legacy / non-citizen recipients).
 */
export async function resolveCitizenAddress(
  tx: EnqueueWriter,
  tenantId: string,
  citizenId: string,
  channel: PackNotificationChannel,
): Promise<string | null> {
  if (channel === "in_app") return citizenId;
  if (!UUID_RE.test(citizenId)) return citizenId;
  const rows = await (tx as unknown as ProfileReader)
    .select({ email: citizenProfiles.email, mobile: citizenProfiles.mobile })
    .from(citizenProfiles)
    .where(and(eq(citizenProfiles.id, citizenId), eq(citizenProfiles.tenantId, tenantId)))
    .limit(1);
  const profile = rows[0];
  const address = channel === "email" ? profile?.email : profile?.mobile;
  return typeof address === "string" && address.trim().length > 0 ? address.trim() : null;
}

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
    // V4-G-06: send to the citizen's real address, not their profile UUID.
    const recipient = await resolveCitizenAddress(
      tx, args.tenantId, args.recipientId ?? args.recipient, b.channel,
    );
    if (recipient === null) continue; // no address on file for this channel
    const payload: NotificationSendPayload = buildNotificationPayload({
      eventType,
      recipient,
      // exactOptionalPropertyTypes: omit optional keys instead of passing undefined.
      ...(args.recipientId !== undefined ? { recipientId: args.recipientId } : {}),
      channel: b.channel,
      ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
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
