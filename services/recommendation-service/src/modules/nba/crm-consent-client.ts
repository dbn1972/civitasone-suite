/**
 * P2-1 — CRM `marketing_consent` lookup over HTTP.
 *
 * Consent for a consent-gated next-best-action is a fact owned by crm-service
 * (`crm.contacts.marketing_consent`), not something the caller may assert about
 * itself. recommendation_svc has no grant on the crm database (DB-per-service,
 * zero cross-database grants), so a JOIN is impossible and the only correct
 * read is the crm-service HTTP API over the internal service-to-service path
 * (`x-internal` + `x-service-secret`) that `@civitasone/auth` authenticates.
 *
 * This deliberately mirrors notification-service deliveries/crm-consent-client.ts
 * (R1/R3): one shape for "ask CRM whether marketing consent exists", so the
 * fail-closed reasoning only has to be reviewed once.
 *
 * Fail closed: anything short of an explicit `marketingConsent: true` returns a
 * non-`granted` verdict and the gated action is suppressed. A CRM outage
 * narrows what we recommend; it never opens consent-gated actions up.
 *
 * The verdict is intentionally NOT cached. A consent withdrawn a minute ago but
 * still served from Redis is a DPDP violation, and the lookup only runs when a
 * candidate is actually gated (see consent-resolution.ts), so it stays off the
 * ordinary NBA path.
 */
import { pino } from "pino";

const log = pino({ name: "recommendation:crm-consent" });

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL ?? "http://127.0.0.1:3024";

/**
 * Tighter than the 5s used on the notification send path: NBA generate is a
 * read with a 200ms p95 budget, so a stalled CRM must fail closed quickly
 * rather than hold the request open. Overridable because the acceptable ceiling
 * is deployment shaped.
 */
const DEFAULT_TIMEOUT_MS = 800;

/** UUID shape check — a non-contact profile id must not become a CRM call. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MarketingConsent = "granted" | "denied" | "unknown";

export type ConsentLookup = (
  profileId: string,
  tenantId: string,
  correlationId: string,
) => Promise<MarketingConsent>;

function timeoutMs(): number {
  const parsed = Number(
    process.env.CRM_CONSENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Read `marketing_consent` for a CRM contact. Never throws — every failure mode
 * collapses to `"unknown"`, which the caller treats as "no consent".
 */
export const fetchMarketingConsent: ConsentLookup = async (
  profileId,
  tenantId,
  correlationId,
) => {
  if (!UUID_RE.test(profileId)) return "unknown";

  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) {
    // Without the shared secret the internal call cannot be authenticated, so
    // consent can never be established. Refuse rather than recommend blind.
    log.warn(
      { tenantId, correlationId },
      "INTERNAL_SERVICE_SECRET unset — marketing consent unverifiable",
    );
    return "unknown";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetch(`${CRM_SERVICE_URL}/v1/crm/contacts/${profileId}`, {
      method: "GET",
      headers: {
        "x-internal": "1",
        "x-service-secret": secret,
        "x-internal-caller": "recommendation-service",
        "x-tenant-id": tenantId,
        "x-correlation-id": correlationId,
        "content-type": "application/json",
      },
      signal: controller.signal,
    });

    if (res.status === 404) {
      // Not a CRM contact, or not in this tenant. No contact, no consent record.
      return "unknown";
    }
    if (!res.ok) {
      log.warn(
        { status: res.status, tenantId, correlationId },
        "crm-service consent lookup returned non-OK",
      );
      return "unknown";
    }

    const body = (await res.json()) as {
      marketingConsent?: unknown;
      data?: { marketingConsent?: unknown };
    };
    const value = body.marketingConsent ?? body.data?.marketingConsent;
    if (value === true) return "granted";
    if (value === false) return "denied";
    // Field absent → the contract changed or the body was not a contact.
    log.warn(
      { tenantId, correlationId },
      "crm-service response carried no marketingConsent field",
    );
    return "unknown";
  } catch (err) {
    log.warn(
      { err, tenantId, correlationId },
      "crm-service consent lookup failed — suppressing consent-gated actions",
    );
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
};
