/**
 * R1/R3 — CRM `marketing_consent` lookup over HTTP.
 *
 * `crm.contacts.marketing_consent` lives in the crm-service database, which
 * notification_svc has no grant on (DB-per-service, zero cross-database
 * grants). A JOIN is therefore impossible; the only correct read is the
 * crm-service HTTP API, using the internal service-to-service path
 * (`x-internal` + `x-service-secret`) that `@civitasone/auth` authenticates.
 *
 * Fail closed: anything short of an explicit `marketingConsent: true` from
 * crm-service returns a non-`granted` verdict, and `consent-gate.ts` refuses
 * the send. A CRM outage stops marketing traffic; it never opens it.
 *
 * The result is intentionally NOT cached. A withdrawn consent that we keep
 * serving from Redis for even a minute is a DPDP violation, and this lookup
 * only runs for marketing sends, not the transactional hot path.
 */
import { pino } from "pino";
import type { MarketingConsent } from "./consent-gate.js";

const log = pino({ name: "notification:crm-consent" });

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL ?? "http://127.0.0.1:3024";
const CRM_TIMEOUT_MS = Number(process.env.CRM_CONSENT_TIMEOUT_MS ?? "5000");

/** UUID shape check — a non-contact recipient id must not become a CRM call. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConsentLookup = (
  contactId: string,
  tenantId: string,
  correlationId: string,
) => Promise<MarketingConsent>;

/**
 * Read `marketing_consent` for a CRM contact. Never throws — every failure
 * mode collapses to `"unknown"`, which the gate treats as "do not send".
 */
export const fetchMarketingConsent: ConsentLookup = async (
  contactId,
  tenantId,
  correlationId,
) => {
  if (!UUID_RE.test(contactId)) return "unknown";

  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) {
    // Without the shared secret the internal call cannot be authenticated, so
    // consent can never be established. Refuse rather than send blind.
    log.warn({ tenantId, correlationId }, "INTERNAL_SERVICE_SECRET unset — marketing consent unverifiable");
    return "unknown";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRM_TIMEOUT_MS);
  try {
    const res = await fetch(`${CRM_SERVICE_URL}/v1/crm/contacts/${contactId}`, {
      method: "GET",
      headers: {
        "x-internal": "1",
        "x-service-secret": secret,
        "x-internal-caller": "notification-service",
        "x-tenant-id": tenantId,
        "x-correlation-id": correlationId,
        "content-type": "application/json",
      },
      signal: controller.signal,
    });

    if (res.status === 404) {
      // Not a CRM contact (or not in this tenant). A marketing send to an
      // unknown identity has no consent record, so it is refused.
      return "unknown";
    }
    if (!res.ok) {
      log.warn({ status: res.status, tenantId, correlationId }, "crm-service consent lookup returned non-OK");
      return "unknown";
    }

    const body = (await res.json()) as { marketingConsent?: unknown; data?: { marketingConsent?: unknown } };
    const value = body.marketingConsent ?? body.data?.marketingConsent;
    if (value === true) return "granted";
    if (value === false) return "denied";
    // Field absent → the contract changed or the body was not a contact.
    log.warn({ tenantId, correlationId }, "crm-service response carried no marketingConsent field");
    return "unknown";
  } catch (err) {
    log.warn({ err, tenantId, correlationId }, "crm-service consent lookup failed — refusing marketing send");
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
};
