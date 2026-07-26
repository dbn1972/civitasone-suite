/**
 * GePNIC adapter — Government eProcurement System of NIC integration for
 * tender publication, tender fetch, and award-status exchange.
 *
 * Env-gated: fails closed when GEPNIC_ENABLED !== 'true' OR credentials are
 * missing. When not configured every call throws
 * GepnicAdapterError("INTEGRATION_DISABLED") — it NEVER fabricates a success
 * response for an unconfigured system.
 *
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   GEPNIC_ENABLED    — "true" to activate; anything else → fail-closed
 *   GEPNIC_BASE_URL   — Base URL for the GePNIC API
 *   GEPNIC_API_KEY    — API key / bearer token for authentication
 *   GEPNIC_TIMEOUT_MS — request timeout (default 15000)
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface GepnicTenderPayload {
  /** Local tender identifier (used for idempotency / cross-reference). */
  referenceId: string;
  tenderTitle: string;
  departmentName: string;
  workCategory: string;
  procurementNature: "goods" | "works" | "services";
  /** Estimated value in minor units (paise). */
  estimatedValueMinor: string;
  currency: string;
  publishDate: string;
  bidSubmissionEndAt: string;
}

export interface GepnicTenderPublishResult {
  /** GePNIC-assigned tender id (e.g. "2026_NIC_987654_1"). */
  gepnicTenderId: string;
  status: "published" | "pending_approval";
  publishedAt: string;
}

export interface GepnicTenderDetails {
  gepnicTenderId: string;
  tenderTitle: string;
  departmentName: string;
  procurementNature: string;
  estimatedValueMinor: string;
  currency: string;
  status: "published" | "bidding" | "under_evaluation" | "awarded" | "cancelled";
  bidSubmissionEndAt: string;
  lastUpdatedAt: string;
}

export interface GepnicAwardStatus {
  gepnicTenderId: string;
  status: "pending" | "under_evaluation" | "awarded" | "cancelled" | "retendered";
  awardedBidder?: string | undefined;
  awardedValueMinor?: string | undefined;
  awardOfContractDate?: string | undefined;
  lastUpdatedAt: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class GepnicAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GepnicAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

function cfg(): { enabled: boolean; baseUrl: string; apiKey: string; timeoutMs: number } {
  return {
    enabled: process.env.GEPNIC_ENABLED === "true",
    baseUrl: process.env.GEPNIC_BASE_URL ?? "",
    apiKey: process.env.GEPNIC_API_KEY ?? "",
    timeoutMs: Number(process.env.GEPNIC_TIMEOUT_MS ?? "15000"),
  };
}

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "gepnic",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): { baseUrl: string; apiKey: string; timeoutMs: number } {
  const c = cfg();
  if (!c.enabled || !c.baseUrl || !c.apiKey) {
    throw new GepnicAdapterError(
      "GePNIC integration is not available",
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
 * Publish a tender to GePNIC.
 *
 * Throws GepnicAdapterError("INTEGRATION_DISABLED") when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function publishTender(tender: GepnicTenderPayload): Promise<GepnicTenderPublishResult> {
  const { baseUrl, apiKey, timeoutMs } = assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${baseUrl}/nicgep/v1/tenders`,
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
      throw new GepnicAdapterError(`GePNIC API returned ${res.status}`, "GEPNIC_API_ERROR", res.status);
    }

    const data = await res.json() as { gepnicTenderId?: string; status?: string; publishedAt?: string };
    return {
      gepnicTenderId: data.gepnicTenderId ?? "",
      status: data.status === "published" ? "published" : "pending_approval",
      publishedAt: data.publishedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Fetch a published tender's details from GePNIC.
 *
 * Throws GepnicAdapterError("INTEGRATION_DISABLED") when not configured.
 */
export async function fetchTender(gepnicTenderId: string): Promise<GepnicTenderDetails> {
  const { baseUrl, apiKey, timeoutMs } = assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${baseUrl}/nicgep/v1/tenders/${encodeURIComponent(gepnicTenderId)}`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      },
      timeoutMs,
    );

    if (!res.ok) {
      throw new GepnicAdapterError(`GePNIC API returned ${res.status}`, "GEPNIC_API_ERROR", res.status);
    }

    const data = await res.json() as Partial<GepnicTenderDetails> & { status?: string };
    const validStatuses = ["published", "bidding", "under_evaluation", "awarded", "cancelled"] as const;
    const status = validStatuses.includes(data.status as typeof validStatuses[number])
      ? (data.status as GepnicTenderDetails["status"])
      : "published";

    return {
      gepnicTenderId: data.gepnicTenderId ?? gepnicTenderId,
      tenderTitle: data.tenderTitle ?? "",
      departmentName: data.departmentName ?? "",
      procurementNature: data.procurementNature ?? "goods",
      estimatedValueMinor: data.estimatedValueMinor ?? "0",
      currency: data.currency ?? "INR",
      status,
      bidSubmissionEndAt: data.bidSubmissionEndAt ?? "",
      lastUpdatedAt: data.lastUpdatedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Fetch the award-of-contract status for a GePNIC tender.
 *
 * Throws GepnicAdapterError("INTEGRATION_DISABLED") when not configured.
 */
export async function getAwardStatus(gepnicTenderId: string): Promise<GepnicAwardStatus> {
  const { baseUrl, apiKey, timeoutMs } = assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${baseUrl}/nicgep/v1/tenders/${encodeURIComponent(gepnicTenderId)}/award`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      },
      timeoutMs,
    );

    if (!res.ok) {
      throw new GepnicAdapterError(`GePNIC API returned ${res.status}`, "GEPNIC_API_ERROR", res.status);
    }

    const data = await res.json() as Partial<GepnicAwardStatus> & { status?: string };
    const validStatuses = ["pending", "under_evaluation", "awarded", "cancelled", "retendered"] as const;
    const status = validStatuses.includes(data.status as typeof validStatuses[number])
      ? (data.status as GepnicAwardStatus["status"])
      : "pending";

    return {
      gepnicTenderId: data.gepnicTenderId ?? gepnicTenderId,
      status,
      awardedBidder: data.awardedBidder,
      awardedValueMinor: data.awardedValueMinor,
      awardOfContractDate: data.awardOfContractDate,
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
