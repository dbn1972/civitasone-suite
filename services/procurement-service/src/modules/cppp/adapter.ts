/**
 * CPPP adapter — Central Public Procurement Portal (eprocure.gov.in) integration
 * for tender publication, tender fetch, and bid-status exchange.
 *
 * Env-gated: fails closed when CPPP_ENABLED !== 'true' OR credentials are
 * missing. When not configured every call throws
 * CpppAdapterError("INTEGRATION_DISABLED") — it NEVER fabricates a success
 * response for an unconfigured portal.
 *
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   CPPP_ENABLED    — "true" to activate; anything else → fail-closed
 *   CPPP_BASE_URL   — Base URL for the CPPP API
 *   CPPP_API_KEY    — API key / bearer token for authentication
 *   CPPP_TIMEOUT_MS — request timeout (default 15000)
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface CpppTenderPayload {
  /** Local tender identifier (used for idempotency / cross-reference). */
  referenceId: string;
  title: string;
  organisationChain: string;
  tenderType: "open" | "limited" | "single" | "eoi";
  /** Estimated value in minor units (paise). */
  estimatedValueMinor: string;
  currency: string;
  bidSubmissionEndAt: string;
  documents?: Array<{ name: string; url: string }> | undefined;
}

export interface CpppTenderPublishResult {
  /** CPPP-assigned tender id (e.g. "2026_DEPT_123456_1"). */
  cpppTenderId: string;
  status: "published" | "pending_review";
  publishedAt: string;
}

export interface CpppTenderDetails {
  cpppTenderId: string;
  title: string;
  organisationChain: string;
  tenderType: string;
  estimatedValueMinor: string;
  currency: string;
  status: "published" | "under_evaluation" | "awarded" | "cancelled" | "closed";
  bidSubmissionEndAt: string;
  lastUpdatedAt: string;
}

export interface CpppBidStatus {
  cpppTenderId: string;
  status: "open" | "under_evaluation" | "awarded" | "cancelled";
  bidsReceived: number;
  awardedBidder?: string | undefined;
  awardedValueMinor?: string | undefined;
  lastUpdatedAt: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class CpppAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "CpppAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

function cfg(): { enabled: boolean; baseUrl: string; apiKey: string; timeoutMs: number } {
  return {
    enabled: process.env.CPPP_ENABLED === "true",
    baseUrl: process.env.CPPP_BASE_URL ?? "",
    apiKey: process.env.CPPP_API_KEY ?? "",
    timeoutMs: Number(process.env.CPPP_TIMEOUT_MS ?? "15000"),
  };
}

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "cppp",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): { baseUrl: string; apiKey: string; timeoutMs: number } {
  const c = cfg();
  if (!c.enabled || !c.baseUrl || !c.apiKey) {
    throw new CpppAdapterError(
      "CPPP integration is not available",
      "INTEGRATION_DISABLED",
    );
  }
  return { baseUrl: c.baseUrl, apiKey: c.apiKey, timeoutMs: c.timeoutMs };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Publish a tender to CPPP.
 *
 * Throws CpppAdapterError("INTEGRATION_DISABLED") when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function publishTender(tender: CpppTenderPayload): Promise<CpppTenderPublishResult> {
  const { baseUrl, apiKey, timeoutMs } = assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/v1/tenders`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(tender),
      },
      timeoutMs,
    );

    if (!res.ok) {
      throw new CpppAdapterError(`CPPP API returned ${res.status}`, "CPPP_API_ERROR", res.status);
    }

    const data = await res.json() as { cpppTenderId?: string; status?: string; publishedAt?: string };
    return {
      cpppTenderId: data.cpppTenderId ?? "",
      status: data.status === "published" ? "published" : "pending_review",
      publishedAt: data.publishedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Fetch a published tender's details from CPPP.
 *
 * Throws CpppAdapterError("INTEGRATION_DISABLED") when not configured.
 */
export async function fetchTender(cpppTenderId: string): Promise<CpppTenderDetails> {
  const { baseUrl, apiKey, timeoutMs } = assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/v1/tenders/${encodeURIComponent(cpppTenderId)}`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      },
      timeoutMs,
    );

    if (!res.ok) {
      throw new CpppAdapterError(`CPPP API returned ${res.status}`, "CPPP_API_ERROR", res.status);
    }

    const data = await res.json() as Partial<CpppTenderDetails> & { status?: string };
    const validStatuses = ["published", "under_evaluation", "awarded", "cancelled", "closed"] as const;
    const status = validStatuses.includes(data.status as typeof validStatuses[number])
      ? (data.status as CpppTenderDetails["status"])
      : "published";

    return {
      cpppTenderId: data.cpppTenderId ?? cpppTenderId,
      title: data.title ?? "",
      organisationChain: data.organisationChain ?? "",
      tenderType: data.tenderType ?? "open",
      estimatedValueMinor: data.estimatedValueMinor ?? "0",
      currency: data.currency ?? "INR",
      status,
      bidSubmissionEndAt: data.bidSubmissionEndAt ?? "",
      lastUpdatedAt: data.lastUpdatedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Fetch the bid / evaluation status for a CPPP tender.
 *
 * Throws CpppAdapterError("INTEGRATION_DISABLED") when not configured.
 */
export async function getBidStatus(cpppTenderId: string): Promise<CpppBidStatus> {
  const { baseUrl, apiKey, timeoutMs } = assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/v1/tenders/${encodeURIComponent(cpppTenderId)}/bids/status`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      },
      timeoutMs,
    );

    if (!res.ok) {
      throw new CpppAdapterError(`CPPP API returned ${res.status}`, "CPPP_API_ERROR", res.status);
    }

    const data = await res.json() as Partial<CpppBidStatus> & { status?: string };
    const validStatuses = ["open", "under_evaluation", "awarded", "cancelled"] as const;
    const status = validStatuses.includes(data.status as typeof validStatuses[number])
      ? (data.status as CpppBidStatus["status"])
      : "open";

    return {
      cpppTenderId: data.cpppTenderId ?? cpppTenderId,
      status,
      bidsReceived: data.bidsReceived ?? 0,
      awardedBidder: data.awardedBidder,
      awardedValueMinor: data.awardedValueMinor,
      lastUpdatedAt: data.lastUpdatedAt ?? new Date().toISOString(),
    };
  });
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the adapter is enabled and fully configured. */
export function isEnabled(): boolean {
  const c = cfg();
  return c.enabled && c.baseUrl.length > 0 && c.apiKey.length > 0;
}

export { CircuitBreakerOpenError };
