/**
 * MT-006 — web push / in-app messaging domain logic (pure).
 *
 * A device token is a bearer credential: anyone holding it can push to that
 * device. It is treated exactly like PII — encrypted at rest, masked in every
 * response, and never logged.
 */
import type { PrefView } from "../templates/domain.js";

export type Platform = "web" | "android" | "ios";

export const PLATFORMS: readonly Platform[] = ["web", "android", "ios"];

export type SubscriptionView = {
  id: string;
  platform: Platform;
  enabled: boolean;
  /** Masked token — the cleartext is never returned over the API. */
  tokenPreview: string;
};

/** Normalise a token for hashing/dedup: trim only. Tokens are case-sensitive. */
export function normalizeDeviceToken(token: string): string {
  return token.trim();
}

/**
 * Mask a device token for responses and diagnostics: last 4 characters only,
 * with a fixed-width prefix so the length is not leaked either.
 */
export function maskDeviceToken(token: string): string {
  const t = normalizeDeviceToken(token);
  if (t.length <= 4) return "****";
  return `****${t.slice(-4)}`;
}

/**
 * Web Push endpoints must be HTTPS. A plaintext endpoint would leak the
 * subscription (and therefore the ability to push) on the wire.
 */
export function isValidWebPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Does the recipient's preference set permit push for this event type?
 *
 * Mirrors the opt-out semantics already enforced in modules/deliveries/channel.ts:
 * a pref row that exists with push=false is an explicit refusal; no pref row at
 * all means the recipient has expressed nothing, and push — being an
 * interruptive channel — is NOT assumed. Opt-in is required.
 */
export function pushAllowedByPrefs(prefs: PrefView[], eventType?: string): boolean {
  const pref = eventType ? prefs.find((p) => p.eventType === eventType) : prefs[0];
  if (!pref) return false;
  return pref.push;
}

export type StoredSubscription = {
  id: string;
  platform: Platform;
  enabled: boolean;
  tokenHash: string;
};

/**
 * Pick the subscriptions a send should actually target: enabled only, and at
 * most one per distinct token so a device registered twice is not pushed twice.
 * Order is preserved so the first registration of a token wins.
 */
export function selectDeliverableSubscriptions(subs: StoredSubscription[]): StoredSubscription[] {
  const seen = new Set<string>();
  const out: StoredSubscription[] = [];
  for (const s of subs) {
    if (!s.enabled) continue;
    if (seen.has(s.tokenHash)) continue;
    seen.add(s.tokenHash);
    out.push(s);
  }
  return out;
}

/** Count unread messages — used for the in-app badge. */
export function unreadCount(messages: Array<{ readAt: Date | null }>): number {
  return messages.filter((m) => m.readAt === null).length;
}
