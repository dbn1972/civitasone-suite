import { incrementNotificationDelivery } from "@civitasone/observability";
import type { PrefView } from "../templates/domain.js";
import type { SendParams } from "../../adapters/types.js";
import { getAdapter } from "../../adapters/index.js";
import * as channelQueries from "../channels/queries.js";

/** Sentinel channel meaning "recipient opted out — do not send on any channel". */
export const CHANNEL_NONE = "none";

export type ChannelPreference = {
  preferred: string;
  fallbacks: string[];
  /** True when the recipient has a matching pref with every channel disabled. */
  optedOut: boolean;
};

/**
 * P1-1: Resolve preferred channel from user prefs, then tenant default, then email.
 *
 * Opt-out enforcement: when a pref row EXISTS for this event type and the user has
 * disabled every channel (push/inApp/email all false), the recipient is fully
 * opted out — we return `CHANNEL_NONE` with no fallbacks so the consumer records a
 * `skipped` delivery and sends nothing. We must NOT force email here (the old
 * `if (!order.length) order.push("email")` did exactly that, defeating opt-out).
 *
 * When NO pref row exists at all, the recipient hasn't expressed a preference, so
 * we keep the safe default of email.
 */
export function resolvePreferredChannel(
  prefs: PrefView[],
  eventType: string | undefined,
  explicit?: string,
): ChannelPreference {
  if (explicit && explicit !== CHANNEL_NONE && getAdapter(explicit)) {
    return { preferred: explicit, fallbacks: ["email"], optedOut: false };
  }

  const pref = eventType ? prefs.find((p) => p.eventType === eventType) : prefs[0];
  const order: string[] = [];
  if (pref?.push) order.push("push");
  if (pref?.inApp) order.push("in_app");
  if (pref?.email) order.push("email");
  // Commercial channels rank last: a recipient who consented to SMS/WhatsApp
  // *and* email still gets email first, so this cannot change the channel of an
  // existing send. They matter for the recipient who opted in to SMS only —
  // previously read as "all channels off" and treated as a full opt-out.
  if (pref?.sms) order.push("sms");
  if (pref?.whatsapp) order.push("whatsapp");

  if (!order.length) {
    // A pref row exists but all channels are off → fully opted out.
    if (pref) return { preferred: CHANNEL_NONE, fallbacks: [], optedOut: true };
    // No pref expressed → default to email.
    order.push("email");
  }

  const preferred = order[0] ?? "email";
  const fallbacks = [...new Set([...order.slice(1), "email"])].filter((c) => c !== preferred);
  return { preferred, fallbacks, optedOut: false };
}

export async function resolveChannelWithDefault(
  tenantId: string,
  prefs: PrefView[],
  eventType: string | undefined,
  explicit?: string,
): Promise<string> {
  const { preferred, optedOut } = resolvePreferredChannel(prefs, eventType, explicit);
  if (optedOut) return CHANNEL_NONE;
  if (getAdapter(preferred)) return preferred;

  const defaultChannel = await channelQueries.getDefaultChannel(tenantId, preferred);
  if (defaultChannel?.enabled && getAdapter(defaultChannel.type)) return defaultChannel.type;

  return "email";
}

export async function sendWithFallback(
  channels: string[],
  params: SendParams,
): Promise<{ channel: string; error?: string }> {
  const tried = [...new Set(channels)];
  let lastError = "all channel adapters failed";

  for (const type of tried) {
    const adapter = getAdapter(type);
    if (!adapter) continue;
    const result = await adapter.send(params);
    if (result.ok) {
      incrementNotificationDelivery(type, "success");
      return { channel: type };
    }
    lastError = result.error;
    incrementNotificationDelivery(type, "failed");
  }

  return { channel: tried[0] ?? "email", error: lastError };
}
