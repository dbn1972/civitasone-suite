/**
 * G20 — Serviceability port domain logic.
 *
 * Pure functions for cache key computation and degradation decision-making.
 * No side effects, no I/O — everything here is testable without mocking.
 */

/** Cache key for a serviceability lookup result. */
export function serviceabilityCacheKey(
  tenantId: string,
  originPin: string,
  destinationPin: string,
  articleType: string,
): string {
  return `crm:serviceability:${tenantId}:${originPin}:${destinationPin}:${articleType}`;
}

/** The shape returned by apt-adapter's /v1/adapters/apt/serviceability endpoint. */
export interface AdapterServiceabilityResponse {
  serviceable: boolean;
  estimatedDays?: number | null;
  provider?: string | null;
}

/** The shape CRM returns to the caller (enriched with degradation metadata). */
export interface ServiceabilityResult {
  serviceable: boolean | null;
  estimatedDays: number | null;
  provider: string | null;
  degraded: boolean;
}

/**
 * Build a successful (non-degraded) response from the adapter's payload.
 */
export function fromAdapterResponse(raw: AdapterServiceabilityResponse): ServiceabilityResult {
  return {
    serviceable: raw.serviceable,
    estimatedDays: raw.estimatedDays ?? null,
    provider: raw.provider ?? null,
    degraded: false,
  };
}

/**
 * Build a degraded response from a cached value (when the live call failed).
 */
export function degradedFromCache(cached: ServiceabilityResult): ServiceabilityResult {
  return { ...cached, degraded: true };
}

/**
 * Build a degraded response when there is no cached value and the live call failed.
 */
export function degradedUnknown(): ServiceabilityResult {
  return { serviceable: null, estimatedDays: null, provider: null, degraded: true };
}
