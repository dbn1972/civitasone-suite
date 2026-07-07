/**
 * PFMS / e-Kuber adapter — Government Rail integration for payment submission
 * and status enquiry.
 *
 * Env-gated: fails closed when PFMS_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   PFMS_ENABLED   — "true" to activate; anything else → fail-closed
 *   PFMS_BASE_URL  — Base URL for the PFMS/e-Kuber API
 *   PFMS_API_KEY   — API key for authentication
 *
 * No PII is logged — only entity IDs, correlation IDs, and status codes.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface PfmsPayment {
  referenceId: string;
  beneficiaryCode: string;
  amount: string;
  purposeCode: string;
  schemeCode?: string | undefined;
  ddoCode?: string | undefined;
  remarks?: string | undefined;
}

export interface PfmsPaymentResult {
  referenceId: string;
  pfmsTransactionId: string;
  status: "accepted" | "rejected";
  message?: string | undefined;
  timestamp: string;
}

export interface PfmsStatusResult {
  referenceId: string;
  pfmsTransactionId: string;
  status: "pending" | "processing" | "completed" | "failed" | "rejected";
  utrNumber?: string | undefined;
  processedAt?: string | undefined;
  failureReason?: string | undefined;
}

export interface PfmsBeneficiaryResult {
  accountNo: string;
  ifsc: string;
  beneficiaryName: string;
  bankName: string;
  branchName: string;
  isActive: boolean;
}

// ── Errors ────────────────────────────────────────────────────────

export class PfmsAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PfmsAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.PFMS_ENABLED === "true";
const BASE_URL = process.env.PFMS_BASE_URL ?? "";
const API_KEY = process.env.PFMS_API_KEY ?? "";
const TIMEOUT_MS = 15_000; // 15s timeout per requirement 22.4

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "pfms",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED || !BASE_URL) {
    throw new PfmsAdapterError(
      "PFMS integration is not available",
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
 * Submit a payment to PFMS/e-Kuber.
 *
 * Throws PfmsAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function submitPayment(payment: PfmsPayment): Promise<PfmsPaymentResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/payments`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          referenceId: payment.referenceId,
          beneficiaryCode: payment.beneficiaryCode,
          amount: payment.amount,
          purposeCode: payment.purposeCode,
          schemeCode: payment.schemeCode,
          ddoCode: payment.ddoCode,
          remarks: payment.remarks,
        }),
      },
    );

    if (!res.ok) {
      throw new PfmsAdapterError(
        `PFMS API returned ${res.status}`,
        "PFMS_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      referenceId?: string;
      pfmsTransactionId?: string;
      status?: string;
      message?: string;
      timestamp?: string;
    };

    return {
      referenceId: data.referenceId ?? payment.referenceId,
      pfmsTransactionId: data.pfmsTransactionId ?? "",
      status: (data.status === "rejected" ? "rejected" : "accepted") as "accepted" | "rejected",
      message: data.message,
      timestamp: data.timestamp ?? new Date().toISOString(),
    };
  });
}

/**
 * Check payment status by reference ID from PFMS/e-Kuber.
 *
 * Throws PfmsAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function checkStatus(referenceId: string): Promise<PfmsStatusResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/payments/${encodeURIComponent(referenceId)}/status`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new PfmsAdapterError(
        `PFMS API returned ${res.status}`,
        "PFMS_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      referenceId?: string;
      pfmsTransactionId?: string;
      status?: string;
      utrNumber?: string;
      processedAt?: string;
      failureReason?: string;
    };

    const validStatuses = ["pending", "processing", "completed", "failed", "rejected"];
    const status = validStatuses.includes(data.status ?? "") ? data.status as PfmsStatusResult["status"] : "pending";

    return {
      referenceId: data.referenceId ?? referenceId,
      pfmsTransactionId: data.pfmsTransactionId ?? "",
      status,
      utrNumber: data.utrNumber,
      processedAt: data.processedAt,
      failureReason: data.failureReason,
    };
  });
}

/**
 * Look up beneficiary details by account number from PFMS/e-Kuber.
 *
 * Throws PfmsAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function getBeneficiary(accountNo: string): Promise<PfmsBeneficiaryResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/beneficiaries/${encodeURIComponent(accountNo)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new PfmsAdapterError(
        `PFMS API returned ${res.status}`,
        "PFMS_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      accountNo?: string;
      ifsc?: string;
      beneficiaryName?: string;
      bankName?: string;
      branchName?: string;
      isActive?: boolean;
    };

    return {
      accountNo: data.accountNo ?? accountNo,
      ifsc: data.ifsc ?? "",
      beneficiaryName: data.beneficiaryName ?? "",
      bankName: data.bankName ?? "",
      branchName: data.branchName ?? "",
      isActive: data.isActive ?? false,
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
