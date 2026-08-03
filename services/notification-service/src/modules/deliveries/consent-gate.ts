/**
 * R1 — outbound consent gate (STOP-SHIP fix).
 *
 * Every outbound send must pass this gate BEFORE any channel adapter is
 * invoked. Before this module existed, `suppressionList` and `dndWindows` were
 * written but never read on the send path: a hard-bounced address, a recipient
 * inside a DND window and a CRM contact with `marketing_consent = false` were
 * all still delivered to.
 *
 * The gate is *fail closed*. When a required consent signal cannot be
 * established (CRM unreachable, contact not found, no recorded opt-in on a
 * commercial channel) the send is refused, not attempted.
 *
 * Evaluation order — terminal refusals first, deferral last, so we never park a
 * message in the DND hold table that we would have refused anyway:
 *
 *   1. suppression list  (hard bounce / operator block)  → skip, terminal
 *   2. marketing consent (CRM `marketing_consent`)       → skip, terminal
 *   3. per-channel consent (`templates.prefs`)           → skip, terminal
 *   4. DND window                                        → hold, retried later
 *   5. send
 *
 * This file is deliberately pure: it performs no I/O. The caller supplies the
 * already-loaded signals, which keeps the decision unit-testable and keeps the
 * HTTP consent lookup out of the send transaction.
 */
import type { DndDecision } from "../dnd/domain.js";

/** The consent-bearing subset of a `templates.prefs` row. */
export type ConsentPref = {
  eventType: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
  sms: boolean;
  whatsapp: boolean;
};

/** Result of the CRM `marketing_consent` lookup. `unknown` fails closed. */
export type MarketingConsent = "granted" | "denied" | "unknown";

export type SkipReason =
  | "recipient_suppressed"
  | "marketing_consent_denied"
  | "marketing_consent_unknown"
  | "channel_consent_denied";

export type GateDecision =
  /** Cleared to send, on these channels only (non-consented ones removed). */
  | { action: "send"; channels: string[] }
  /** Terminal refusal — record `skipped`, emit audit, do not retry. */
  | { action: "skip"; reason: SkipReason }
  /** Deferred — park in `dnd.held_notifications` until `releaseAt`. */
  | { action: "hold"; releaseAt: Date };

export type GateInput = {
  /** Recipient is on the tenant's active suppression list. */
  suppressed: boolean;
  /** Outcome of `isDndActive()` over the recipient's enabled windows. */
  dnd: DndDecision;
  /** All prefs rows for the recipient within the tenant. */
  prefs: ConsentPref[];
  eventType?: string | undefined;
  /** Channels the delivery would attempt, in order (preferred + fallbacks). */
  candidateChannels: string[];
  /**
   * Whether this send is a commercial/marketing message, and the CRM consent
   * that was looked up for it. `required: false` means a transactional send —
   * CRM marketing consent does not apply and is not consulted.
   */
  marketing: { required: boolean; consent: MarketingConsent };
};

const CHANNEL_CONSENT_FIELD: Record<string, keyof ConsentPref> = {
  in_app: "inApp",
  email: "email",
  push: "push",
  sms: "sms",
  whatsapp: "whatsapp",
};

/**
 * Channels that may be used when the recipient has no pref row at all.
 *
 * `email`/`in_app`/`push` are the transactional channels a government
 * recipient is expected to receive on (a payslip, an approval, an OTP) and
 * pre-date the prefs table, so absence of a row means "no preference
 * expressed", not "refused".
 *
 * `sms` and `whatsapp` are commercial channels under TRAI/DLT: absence of a
 * recorded opt-in means NOT consented. `webhook` is a tenant-configured
 * machine endpoint, not a person, so recipient consent does not apply to it.
 */
const CONSENT_IMPLIED_WITHOUT_PREF = new Set(["email", "in_app", "push", "webhook"]);

/** The pref row governing this send: event-specific if present, else the first. */
export function findPref(prefs: ConsentPref[], eventType?: string | undefined): ConsentPref | undefined {
  if (eventType) {
    const exact = prefs.find((p) => p.eventType === eventType);
    if (exact) return exact;
  }
  return prefs[0];
}

/**
 * Has the recipient consented to this channel?
 *
 * A matching pref row is authoritative — including when the caller passed an
 * explicit `channel` override, which used to bypass prefs entirely and was the
 * simplest way to send to someone who had opted out.
 */
export function channelConsented(
  channel: string,
  pref: ConsentPref | undefined,
): boolean {
  const field = CHANNEL_CONSENT_FIELD[channel];
  if (pref && field) return pref[field] === true;
  return CONSENT_IMPLIED_WITHOUT_PREF.has(channel);
}

/**
 * Decide whether this send may proceed. Pure — see the module comment for the
 * evaluation order and the fail-closed rules.
 */
export function decideGate(input: GateInput): GateDecision {
  if (input.suppressed) return { action: "skip", reason: "recipient_suppressed" };

  if (input.marketing.required) {
    if (input.marketing.consent === "denied") {
      return { action: "skip", reason: "marketing_consent_denied" };
    }
    if (input.marketing.consent === "unknown") {
      // Fail closed: an unverifiable consent state is not consent.
      return { action: "skip", reason: "marketing_consent_unknown" };
    }
  }

  const pref = findPref(input.prefs, input.eventType);
  // Filter the whole attempt list, not just the preferred channel: otherwise a
  // consented preferred channel could still fall back onto a refused one.
  const channels = input.candidateChannels.filter((c) => channelConsented(c, pref));
  if (channels.length === 0) return { action: "skip", reason: "channel_consent_denied" };

  if (input.dnd.action === "hold") return { action: "hold", releaseAt: input.dnd.releaseAt };

  return { action: "send", channels };
}

/**
 * Is this send a commercial/marketing message subject to CRM
 * `marketing_consent`? True when the producer says so explicitly
 * (`category: "marketing"`), when it belongs to a campaign, or when the event
 * type is in a marketing namespace. Anything else is transactional.
 */
export function isMarketingSend(input: {
  category?: string | undefined;
  campaignId?: string | undefined;
  eventType?: string | undefined;
}): boolean {
  if (input.category === "marketing") return true;
  if (input.campaignId) return true;
  const evt = input.eventType ?? "";
  return evt.startsWith("marketing.") || evt.startsWith("campaign.");
}
