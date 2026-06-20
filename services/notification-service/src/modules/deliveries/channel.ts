import { incrementNotificationDelivery } from "@civitasone/observability";
import type { PrefView } from "../templates/domain.js";
import type { SendParams } from "../../adapters/types.js";
import { getAdapter } from "../../adapters/index.js";
import * as channelQueries from "../channels/queries.js";

export type ChannelPreference = {
  preferred: string;
  fallbacks: string[];
};

/** Resolve preferred channel from user prefs, then tenant default, then email. */
export function resolvePreferredChannel(
  prefs: PrefView[],
  eventType: string | undefined,
  explicit?: string,
): ChannelPreference {
  if (explicit && getAdapter(explicit)) {
    return { preferred: explicit, fallbacks: ["email"] };
  }

  const pref = eventType ? prefs.find((p) => p.eventType === eventType) : prefs[0];
  const order: string[] = [];
  if (pref?.push) order.push("push");
  if (pref?.inApp) order.push("in_app");
  if (pref?.email) order.push("email");
  if (!order.length) order.push("email");

  const preferred = order[0] ?? "email";
  const fallbacks = [...new Set([...order.slice(1), "email"])].filter((c) => c !== preferred);
  return { preferred, fallbacks };
}

export async function resolveChannelWithDefault(
  tenantId: string,
  prefs: PrefView[],
  eventType: string | undefined,
  explicit?: string,
): Promise<string> {
  const { preferred } = resolvePreferredChannel(prefs, eventType, explicit);
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
