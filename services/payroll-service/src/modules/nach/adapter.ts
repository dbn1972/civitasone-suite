/**
 * NACH/APBS adapter — Government Rail integration for mandate and bulk payment.
 *
 * Env-gated: fails closed when NACH_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   NACH_ENABLED   — "true" to activate; anything else → fail-closed
 *   NACH_BASE_URL  — Base URL for the NACH/APBS API
 *   NACH_API_KEY   — API key for authentication
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface MandateInput {
  employeeRef: string;
  amountMinor: bigint;
  frequency: "monthly" | "quarterly" | "yearly" | "one-time";
  startDate: string;
  endDate: string;
  accountType: "savings" | "current";
  umrn?: string | undefined;
}

export interface MandateResult {
  mandateRef: string;
  status: "submitted" | "pending_auth" | "active" | "rejected" | "cancelled";
  umrn: string;
  submittedAt: string;
}

export interface MandateStatusResult {
  mandateRef: string;
  status: "submitted" | "pending_auth" | "active" | "rejected" | "cancelled";
  umrn: string;
  lastUpdated: string;
  reasonCode?: string | undefined;
  reasonText?: string | undefined;
}

export interface BulkPaymentInput {
  batchRef: string;
  mandateRef: string;
  totalAmountMinor: bigint;
  beneficiaryCount: number;
  scheduledDate: string;
}

export interface BulkPaymentResult {
  batchRef: string;
  transactionId: string;
  status: "submitted" | "processing" | "completed" | "failed";
  submittedAt: string;
  beneficiaryCount: number;
}

// ── Errors ────────────────────────────────────────────────────────

export class NachAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "NachAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.NACH_ENABLED === "true";
const BASE_URL = process.env.NACH_BASE_URL ?? "";
const API_KEY = process.env.NACH_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.NACH_TIMEOUT_MS ?? "15000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "nach",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new NachAdapterError(
      "NACH/APBS integration is not available",
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
 * Submit a NACH mandate registration request.
 *
 * Throws NachAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function submitMandate(mandate: MandateInput): Promise<MandateResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/mandates`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          employeeRef: mandate.employeeRef,
          amountMinor: mandate.amountMinor.toString(),
          frequency: mandate.frequency,
          startDate: mandate.startDate,
          endDate: mandate.endDate,
          accountType: mandate.accountType,
          umrn: mandate.umrn,
        }),
      },
    );

    if (!res.ok) {
      throw new NachAdapterError(
        `NACH API returned ${res.status}`,
        "NACH_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      mandateRef?: string;
      status?: string;
      umrn?: string;
      submittedAt?: string;
    };

    return {
      mandateRef: data.mandateRef ?? "",
      status: (data.status as MandateResult["status"]) ?? "submitted",
      umrn: data.umrn ?? "",
      submittedAt: data.submittedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Check the current status of a NACH mandate.
 *
 * Throws NachAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function checkMandateStatus(mandateRef: string): Promise<MandateStatusResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/mandates/${encodeURIComponent(mandateRef)}/status`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new NachAdapterError(
        `NACH API returned ${res.status}`,
        "NACH_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      mandateRef?: string;
      status?: string;
      umrn?: string;
      lastUpdated?: string;
      reasonCode?: string;
      reasonText?: string;
    };

    return {
      mandateRef: data.mandateRef ?? mandateRef,
      status: (data.status as MandateStatusResult["status"]) ?? "submitted",
      umrn: data.umrn ?? "",
      lastUpdated: data.lastUpdated ?? new Date().toISOString(),
      reasonCode: data.reasonCode,
      reasonText: data.reasonText,
    };
  });
}

/**
 * Submit a bulk payment batch through NACH/APBS.
 *
 * Throws NachAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function submitBulkPayment(batch: BulkPaymentInput): Promise<BulkPaymentResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/payments/bulk`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          batchRef: batch.batchRef,
          mandateRef: batch.mandateRef,
          totalAmountMinor: batch.totalAmountMinor.toString(),
          beneficiaryCount: batch.beneficiaryCount,
          scheduledDate: batch.scheduledDate,
        }),
      },
    );

    if (!res.ok) {
      throw new NachAdapterError(
        `NACH API returned ${res.status}`,
        "NACH_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      batchRef?: string;
      transactionId?: string;
      status?: string;
      submittedAt?: string;
      beneficiaryCount?: number;
    };

    return {
      batchRef: data.batchRef ?? batch.batchRef,
      transactionId: data.transactionId ?? "",
      status: (data.status as BulkPaymentResult["status"]) ?? "submitted",
      submittedAt: data.submittedAt ?? new Date().toISOString(),
      beneficiaryCount: data.beneficiaryCount ?? batch.beneficiaryCount,
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
