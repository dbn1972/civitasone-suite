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
 * commercial channel for a MARKETING send) the send is refused, not attempted.
 *
 * "Required" is the load-bearing word. Consent requirements differ by purpose:
 * a marketing SMS needs a recorded opt-in, a login OTP or an evacuation alert
 * does not — refusing those is not caution, it is an outage. So the strict
 * commercial-channel rule is conditional on `marketing.required`, while an
 * explicit opt-out (`false`) is honoured on every send regardless of purpose.
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

/**
 * The consent-bearing subset of a `templates.prefs` row.
 *
 * The commercial channels are TRI-STATE (migration 0031): `null` means the
 * recipient has never expressed a choice, which is not the same fact as `false`
 * (they refused). Collapsing the two is what made the gate refuse transactional
 * SMS.
 */
export type ConsentPref = {
  eventType: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
  sms: boolean | null;
  whatsapp: boolean | null;
};

/** Result of the CRM `marketing_consent` lookup. `unknown` fails closed. */
export type MarketingConsent = "granted" | "denied" | "unknown";

/**
 * The CRM verdict as the gate receives it. `deferred` means "this IS a marketing
 * send, but a later stage performs the CRM lookup" — used by the bulk fan-out,
 * which runs inside a transaction and must not make an outbound HTTP call.
 */
export type GateMarketingConsent = MarketingConsent | "deferred";

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
   * CRM marketing consent does not apply and is not consulted, and the
   * commercial channels do not demand a recorded opt-in.
   */
  marketing: { required: boolean; consent: GateMarketingConsent };
};

const CHANNEL_CONSENT_FIELD: Record<string, keyof ConsentPref> = {
  in_app: "inApp",
  email: "email",
  push: "push",
  sms: "sms",
  whatsapp: "whatsapp",
};

/**
 * Channels a recipient is presumed to accept when they have expressed no choice.
 *
 * `email`/`in_app`/`push` are the channels a government recipient is expected to
 * receive on (a payslip, an approval, an OTP) and pre-date the prefs table, so
 * absence of a choice means "no preference expressed", not "refused".
 * `webhook` is a tenant-configured machine endpoint, not a person, so recipient
 * consent does not apply to it.
 *
 * `sms` and `whatsapp` are deliberately absent — see
 * `OPT_IN_REQUIRED_FOR_MARKETING`.
 */
const CONSENT_IMPLIED_WITHOUT_CHOICE = new Set(["email", "in_app", "push", "webhook"]);

/**
 * Channels that require a RECORDED opt-in before a commercial send.
 *
 * TRAI/DLT and DPDP purpose limitation govern *promotional* traffic, and only
 * that: statutory and transactional messages on these channels are expressly
 * permitted without a marketing opt-in, and are the normal carrier for a login
 * OTP or an emergency evacuation alert. So the strict rule is scoped to
 * marketing sends. For transactional traffic, "no choice recorded" behaves like
 * every other channel: allowed. An explicit `false` still refuses both kinds.
 */
const OPT_IN_REQUIRED_FOR_MARKETING = new Set(["sms", "whatsapp"]);

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
 * A recorded choice is authoritative in BOTH directions — including when the
 * caller passed an explicit `channel` override, which used to bypass prefs
 * entirely and was the simplest way to send to someone who had opted out.
 *
 * When no choice is recorded, the answer depends on the channel and on whether
 * this is a marketing send: only the commercial channels demand a positive
 * opt-in, and only for marketing.
 */
export function channelConsented(
  channel: string,
  pref: ConsentPref | undefined,
  marketingRequired: boolean,
): boolean {
  const field = CHANNEL_CONSENT_FIELD[channel];
  if (!field) return CONSENT_IMPLIED_WITHOUT_CHOICE.has(channel);

  const recorded = pref?.[field] ?? null;
  if (recorded !== null) return recorded === true;

  if (OPT_IN_REQUIRED_FOR_MARKETING.has(channel)) return !marketingRequired;
  return CONSENT_IMPLIED_WITHOUT_CHOICE.has(channel);
}

/**
 * Decide whether this send may proceed. Pure — see the module comment for the
 * evaluation order and the fail-closed rules.
 */
export function decideGate(input: GateInput): GateDecision {
  if (input.suppressed) return { action: "skip", reason: "recipient_suppressed" };

  // `deferred` is not a verdict — the caller has told us a later stage does the
  // CRM lookup, so there is nothing to evaluate here yet.
  if (input.marketing.required && input.marketing.consent !== "deferred") {
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
  const channels = input.candidateChannels.filter(
    (c) => channelConsented(c, pref, input.marketing.required),
  );
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
