/**
 * e-Courts / NJDG adapter — Government Rail integration for CNR lookup.
 *
 * Env-gated: fails closed when ECOURTS_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   ECOURTS_ENABLED   — "true" to activate; anything else → fail-closed
 *   ECOURTS_BASE_URL  — Base URL for the e-Courts/NJDG API
 *   ECOURTS_API_KEY   — API key for authentication
 *
 * No PII is logged — only entity IDs and status codes.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface HearingDate {
  date: string;
  purpose: string;
}

export interface CourtOrder {
  date: string;
  description: string;
  downloadUrl?: string | undefined;
}

export interface CnrLookupResult {
  cnrNumber: string;
  caseStatus: string;
  courtName: string;
  hearingDates: HearingDate[];
  orders: CourtOrder[];
  lastUpdated: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class ECourtsAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ECourtsAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.ECOURTS_ENABLED === "true";
const BASE_URL = process.env.ECOURTS_BASE_URL ?? "";
const API_KEY = process.env.ECOURTS_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.ECOURTS_TIMEOUT_MS ?? "10000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "ecourts",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new ECourtsAdapterError(
      "e-Courts integration is not available",
      "INTEGRATION_DISABLED",
    );
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Look up a case by CNR (Case Number Record) from e-Courts/NJDG.
 *
 * Returns case status, hearing dates, and court orders.
 * Throws ECourtsAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function lookupCnr(cnrNumber: string): Promise<CnrLookupResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/cases/cnr/${encodeURIComponent(cnrNumber)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ECourtsAdapterError(
        `e-Courts API returned ${res.status}`,
        "ECOURTS_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      cnrNumber?: string;
      caseStatus?: string;
      courtName?: string;
      hearingDates?: Array<{ date: string; purpose: string }>;
      orders?: Array<{ date: string; description: string; downloadUrl?: string }>;
      lastUpdated?: string;
    };

    return {
      cnrNumber: data.cnrNumber ?? cnrNumber,
      caseStatus: data.caseStatus ?? "unknown",
      courtName: data.courtName ?? "",
      hearingDates: data.hearingDates ?? [],
      orders: data.orders ?? [],
      lastUpdated: data.lastUpdated ?? new Date().toISOString(),
    };
  });
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the adapter is enabled and configured. */
export function isEnabled(): boolean {
  return ENABLED && BASE_URL.length > 0 && API_KEY.length > 0;
}
