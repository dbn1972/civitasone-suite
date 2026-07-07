/**
 * GSTN adapter — Government Rail integration for GST return filing and GSTIN verification.
 *
 * Env-gated: fails closed when GSTN_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   GSTN_ENABLED   — "true" to activate; anything else → fail-closed
 *   GSTN_BASE_URL  — Base URL for the GSTN API
 *   GSTN_API_KEY   — API key for authentication
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface GstReturnPayload {
  gstin: string;
  returnPeriod: string;
  returnType: string;
  totalTaxableValue: string;
  totalCgst: string;
  totalSgst: string;
  totalIgst: string;
}

export interface GstReturnResult {
  referenceId: string;
  status: "submitted" | "processing" | "filed" | "rejected";
  gstin: string;
  returnPeriod: string;
  submittedAt: string;
}

export interface GstinVerificationResult {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: "active" | "inactive" | "cancelled" | "suspended";
  registrationDate: string;
  lastUpdated: string;
}

export interface ReturnStatusResult {
  referenceId: string;
  status: "submitted" | "processing" | "filed" | "rejected";
  returnPeriod: string;
  filedAt?: string | undefined;
  rejectionReason?: string | undefined;
  lastUpdated: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class GstnAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GstnAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.GSTN_ENABLED === "true";
const BASE_URL = process.env.GSTN_BASE_URL ?? "";
const API_KEY = process.env.GSTN_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.GSTN_TIMEOUT_MS ?? "15000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "gstn",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new GstnAdapterError(
      "GSTN integration is not available",
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
 * Submit a GST return filing to GSTN.
 *
 * Throws GstnAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function submitGstReturn(payload: GstReturnPayload): Promise<GstReturnResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/returns`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          gstin: payload.gstin,
          returnPeriod: payload.returnPeriod,
          returnType: payload.returnType,
          totalTaxableValue: payload.totalTaxableValue,
          totalCgst: payload.totalCgst,
          totalSgst: payload.totalSgst,
          totalIgst: payload.totalIgst,
        }),
      },
    );

    if (!res.ok) {
      throw new GstnAdapterError(
        `GSTN API returned ${res.status}`,
        "GSTN_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      referenceId?: string;
      status?: string;
      gstin?: string;
      returnPeriod?: string;
      submittedAt?: string;
    };

    return {
      referenceId: data.referenceId ?? "",
      status: (data.status as GstReturnResult["status"]) ?? "submitted",
      gstin: data.gstin ?? payload.gstin,
      returnPeriod: data.returnPeriod ?? payload.returnPeriod,
      submittedAt: data.submittedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Verify a GSTIN number against GSTN registry.
 *
 * Throws GstnAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function verifyGstin(gstin: string): Promise<GstinVerificationResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/gstin/${encodeURIComponent(gstin)}/verify`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new GstnAdapterError(
        `GSTN API returned ${res.status}`,
        "GSTN_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      gstin?: string;
      legalName?: string;
      tradeName?: string;
      status?: string;
      registrationDate?: string;
      lastUpdated?: string;
    };

    return {
      gstin: data.gstin ?? gstin,
      legalName: data.legalName ?? "",
      tradeName: data.tradeName ?? "",
      status: (data.status as GstinVerificationResult["status"]) ?? "active",
      registrationDate: data.registrationDate ?? "",
      lastUpdated: data.lastUpdated ?? new Date().toISOString(),
    };
  });
}

/**
 * Fetch the status of a previously submitted GST return.
 *
 * Throws GstnAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function fetchReturnStatus(ref: string): Promise<ReturnStatusResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/returns/${encodeURIComponent(ref)}/status`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new GstnAdapterError(
        `GSTN API returned ${res.status}`,
        "GSTN_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      referenceId?: string;
      status?: string;
      returnPeriod?: string;
      filedAt?: string;
      rejectionReason?: string;
      lastUpdated?: string;
    };

    return {
      referenceId: data.referenceId ?? ref,
      status: (data.status as ReturnStatusResult["status"]) ?? "processing",
      returnPeriod: data.returnPeriod ?? "",
      filedAt: data.filedAt,
      rejectionReason: data.rejectionReason,
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

export { CircuitBreakerOpenError };
