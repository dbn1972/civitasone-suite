/**
 * FN-30 — Service API / Webhook Exposure (pure domain, no I/O).
 *
 * BRD: "opt-in REST webhook on application state changes for inter-agency
 * integration (police verification callback) … Gap: per-service subscription
 * config. Acceptance: staging webhook receives `issued` event payload."
 *
 * Delivery and HMAC signing already exist in notification-service/webhook. What
 * was missing is the per-service subscription: which events a published service
 * exposes, who may receive them, and what the payload is allowed to contain.
 * This module is that config layer; it does not send anything.
 *
 * Two decisions worth stating, because both are deliberate narrowings:
 *
 * 1. The event catalogue is DERIVED from APPLICATION_STATUSES rather than
 *    hand-listed. A hand-written list drifts: someone adds a status and the
 *    webhook catalogue silently lacks it, or removes one and subscribers keep
 *    subscribing to an event that will never fire again. Deriving it makes both
 *    impossible.
 *
 * 2. The payload carries case metadata only — never form answers, applicant
 *    identity or document contents. A generic outbound webhook is the wrong
 *    channel for identity data: subscriptions are configured per tenant by
 *    admins, the endpoint is arbitrary, and the citizen consented to a service,
 *    not to a broadcast. Integrations that genuinely need applicant data (the
 *    BRD's police-verification example) go through an Engine Binding, which is
 *    a named, reviewed counterparty. See buildWebhookEvent below.
 */

import { APPLICATION_STATUSES, type ApplicationStatus } from "../application/domain.js";

/** `application.submitted`, `application.issued`, … — one per real status. */
export const WEBHOOK_EVENTS = APPLICATION_STATUSES.map((s) => `application.${s}` as const);
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

export function eventForStatus(status: ApplicationStatus): WebhookEvent {
  return `application.${status}` as WebhookEvent;
}

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export interface ServiceWebhookSubscription {
  id: string;
  /** HTTPS endpoint of the receiving agency. */
  url: string;
  /** Subset of WEBHOOK_EVENTS this endpoint wants. Empty is rejected. */
  events: WebhookEvent[];
  /** Shared secret for the HMAC signature notification-service applies. */
  secret: string;
  active: boolean;
  /** Which agency/system this is, for the audit trail. */
  description?: string | undefined;
}

export class ServiceWebhookError extends Error {}

/**
 * Hosts an outbound webhook must never be pointed at.
 *
 * A tenant admin who can type a URL can otherwise make the platform issue
 * requests to its own internal network or to the cloud metadata endpoint —
 * classic SSRF, and it lands at *config* time, which is why the check belongs
 * here. notification-service's validateEndpointUrl checks the scheme only; this
 * is the stricter gate on the way in.
 */
function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  // Cloud instance metadata.
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. metadata
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;

  return false;
}

/** Publish gate for a service's webhook subscriptions. */
export function assertWebhookSubscriptions(
  subscriptions: unknown,
): asserts subscriptions is ServiceWebhookSubscription[] {
  if (subscriptions == null) return;
  if (!Array.isArray(subscriptions)) throw new ServiceWebhookError("WEBHOOKS_NOT_A_LIST");

  const seenId = new Set<string>();
  for (const raw of subscriptions) {
    if (!raw || typeof raw !== "object") throw new ServiceWebhookError("WEBHOOK_NOT_AN_OBJECT");
    const s = raw as ServiceWebhookSubscription;

    if (typeof s.id !== "string" || s.id.trim().length === 0) {
      throw new ServiceWebhookError("WEBHOOK_MISSING_ID");
    }
    if (seenId.has(s.id)) throw new ServiceWebhookError(`WEBHOOK_DUPLICATE_ID: ${s.id}`);
    seenId.add(s.id);

    let parsed: URL;
    try {
      parsed = new URL(String(s.url));
    } catch {
      throw new ServiceWebhookError(`WEBHOOK_BAD_URL: ${s.id}`);
    }
    if (parsed.protocol !== "https:") {
      // Case metadata about a citizen's application must not cross the network
      // in the clear, even inside a government WAN.
      throw new ServiceWebhookError(`WEBHOOK_NOT_HTTPS: ${s.id}`);
    }
    if (isForbiddenHost(parsed.hostname)) {
      throw new ServiceWebhookError(`WEBHOOK_FORBIDDEN_HOST: ${s.id}`);
    }

    if (!Array.isArray(s.events) || s.events.length === 0) {
      // A subscription that receives nothing is dead config that reads, to the
      // next admin, as a working integration.
      throw new ServiceWebhookError(`WEBHOOK_NO_EVENTS: ${s.id}`);
    }
    const seenEvent = new Set<string>();
    for (const e of s.events) {
      if (!isWebhookEvent(String(e))) throw new ServiceWebhookError(`WEBHOOK_UNKNOWN_EVENT: ${e}`);
      if (seenEvent.has(e)) throw new ServiceWebhookError(`WEBHOOK_DUPLICATE_EVENT: ${e}`);
      seenEvent.add(e);
    }

    if (typeof s.secret !== "string" || s.secret.length < 16) {
      // The signature is the receiver's only proof the callback is ours.
      throw new ServiceWebhookError(`WEBHOOK_WEAK_SECRET: ${s.id}`);
    }
    if (typeof s.active !== "boolean") throw new ServiceWebhookError(`WEBHOOK_MISSING_ACTIVE: ${s.id}`);
  }
}

/** Active subscriptions that asked for this event. */
export function subscribersFor(
  subscriptions: readonly ServiceWebhookSubscription[] | null | undefined,
  event: WebhookEvent,
): ServiceWebhookSubscription[] {
  return (subscriptions ?? []).filter((s) => s.active && s.events.includes(event));
}

export interface WebhookEventPayload {
  event: WebhookEvent;
  /** ISO-8601; supplied by the caller so the payload is reproducible in tests. */
  occurredAt: string;
  serviceKey: string;
  applicationNumber: string;
  status: ApplicationStatus;
  tenantId: string;
  officeId?: string | undefined;
  /** Present only on terminal issuance events. */
  outputNumber?: string | undefined;
}

/**
 * Build the outbound payload for a state change.
 *
 * Every key is written out explicitly. Nothing is spread in from the
 * application record, so a column added to `applications` later cannot start
 * leaving the platform without someone editing this function — the same
 * structural guarantee FN-28 uses for the RTI export.
 */
export function buildWebhookEvent(input: {
  status: ApplicationStatus;
  occurredAt: string;
  serviceKey: string;
  applicationNumber: string;
  tenantId: string;
  officeId?: string | null;
  outputNumber?: string | null;
}): WebhookEventPayload {
  const event = eventForStatus(input.status);
  return {
    event,
    occurredAt: input.occurredAt,
    serviceKey: input.serviceKey,
    applicationNumber: input.applicationNumber,
    status: input.status,
    tenantId: input.tenantId,
    ...(input.officeId ? { officeId: input.officeId } : {}),
    // Only the issuance event carries the output number; on any other state it
    // does not exist yet and sending a stale one would misinform the receiver.
    ...(input.status === "issued" && input.outputNumber ? { outputNumber: input.outputNumber } : {}),
  };
}
