/**
 * UPI-autopay and e-mandate payment adapter.
 *
 * Env-gated behind:
 *   PAYMENT_UPI_ENABLED      — "true" to enable UPI autopay
 *   PAYMENT_EMANDATE_ENABLED — "true" to enable e-mandate
 *   UPI_AUTOPAY_BASE_URL     — API base URL for UPI autopay provider
 *   EMANDATE_BASE_URL        — API base URL for e-mandate provider
 *   UPI_AUTOPAY_API_KEY      — API key for UPI autopay
 *   EMANDATE_API_KEY         — API key for e-mandate
 *
 * Requirements: 13.4, 13.5
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { GatewayError } from "./types.js";
import { withRetry } from "./retry.js";

// ── Config ────────────────────────────────────────────────────────

const UPI_ENABLED = process.env.PAYMENT_UPI_ENABLED === "true";
const EMANDATE_ENABLED = process.env.PAYMENT_EMANDATE_ENABLED === "true";
const UPI_BASE_URL = process.env.UPI_AUTOPAY_BASE_URL ?? "";
const EMANDATE_BASE_URL = process.env.EMANDATE_BASE_URL ?? "";
const UPI_API_KEY = process.env.UPI_AUTOPAY_API_KEY ?? "";
const EMANDATE_API_KEY = process.env.EMANDATE_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS ?? "10000");

// ── Circuit Breakers ──────────────────────────────────────────────

const upiBreaker = new CircuitBreaker({
  name: "upi-autopay",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

const emandateBreaker = new CircuitBreaker({
  name: "e-mandate",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Types ─────────────────────────────────────────────────────────

export interface UpiAutopayMandate {
  mandateId: string;
  vpa: string;
  maxAmount: bigint;
  frequency: "monthly" | "quarterly" | "yearly" | "one_time";
  status: "created" | "approved" | "revoked" | "failed";
  createdAt: string;
}

export interface UpiAutopayExecution {
  executionId: string;
  mandateId: string;
  amount: bigint;
  status: "initiated" | "success" | "failed";
  executedAt: string;
  errorCode?: string | undefined;
}

export interface EmandateRegistration {
  mandateId: string;
  accountNumber: string;
  ifsc: string;
  maxAmount: bigint;
  frequency: "monthly" | "quarterly" | "yearly";
  status: "pending" | "approved" | "rejected" | "revoked";
  createdAt: string;
}

export interface EmandateExecution {
  executionId: string;
  mandateId: string;
  amount: bigint;
  status: "initiated" | "success" | "failed";
  executedAt: string;
  errorCode?: string | undefined;
}

// ── Helpers ───────────────────────────────────────────────────────

function assertUpiEnabled(): void {
  if (!UPI_ENABLED) {
    throw new GatewayError(
      "UPI-autopay payment method is unavailable",
      "PAYMENT_METHOD_UNAVAILABLE",
      "upi-autopay",
    );
  }
}

function assertEmandateEnabled(): void {
  if (!EMANDATE_ENABLED) {
    throw new GatewayError(
      "e-mandate payment method is unavailable",
      "PAYMENT_METHOD_UNAVAILABLE",
      "e-mandate",
    );
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GatewayError("Request timed out", "GATEWAY_TIMEOUT", "upi-autopay");
    }
    throw new GatewayError("Network error", "GATEWAY_NETWORK_ERROR", "upi-autopay");
  } finally {
    clearTimeout(timer);
  }
}

function handleResponseError(res: Response, context: string, gateway: "upi-autopay" | "e-mandate"): void {
  if (!res.ok) {
    throw new GatewayError(
      `${context} failed (${res.status})`,
      res.status >= 500 ? "GATEWAY_SERVER_ERROR" : "GATEWAY_CLIENT_ERROR",
      gateway,
      res.status,
    );
  }
}

// ── UPI Autopay Public API ────────────────────────────────────────

/**
 * Register a new UPI autopay mandate.
 */
export async function registerUpiMandate(params: {
  vpa: string;
  maxAmountPaise: bigint;
  frequency: UpiAutopayMandate["frequency"];
  tenantId: string;
}): Promise<UpiAutopayMandate> {
  assertUpiEnabled();

  return withRetry(() =>
    upiBreaker.call(async () => {
      const res = await fetchWithTimeout(`${UPI_BASE_URL}/v1/mandates`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${UPI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vpa: params.vpa,
          maxAmount: Number(params.maxAmountPaise),
          frequency: params.frequency,
          tenantId: params.tenantId,
        }),
      });

      handleResponseError(res, "UPI mandate registration", "upi-autopay");

      const data = (await res.json()) as {
        mandateId: string;
        status: string;
        createdAt: string;
      };

      return {
        mandateId: data.mandateId,
        vpa: params.vpa,
        maxAmount: params.maxAmountPaise,
        frequency: params.frequency,
        status: (data.status as UpiAutopayMandate["status"]) ?? "created",
        createdAt: data.createdAt ?? new Date().toISOString(),
      };
    }),
  );
}

/**
 * Execute a payment against an existing UPI autopay mandate.
 */
export async function executeUpiPayment(params: {
  mandateId: string;
  amountPaise: bigint;
  tenantId: string;
}): Promise<UpiAutopayExecution> {
  assertUpiEnabled();

  return withRetry(() =>
    upiBreaker.call(async () => {
      const res = await fetchWithTimeout(`${UPI_BASE_URL}/v1/mandates/${params.mandateId}/execute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${UPI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: Number(params.amountPaise),
          tenantId: params.tenantId,
        }),
      });

      handleResponseError(res, "UPI payment execution", "upi-autopay");

      const data = (await res.json()) as {
        executionId: string;
        status: string;
        executedAt: string;
        errorCode?: string;
      };

      return {
        executionId: data.executionId,
        mandateId: params.mandateId,
        amount: params.amountPaise,
        status: (data.status as UpiAutopayExecution["status"]) ?? "initiated",
        executedAt: data.executedAt ?? new Date().toISOString(),
        errorCode: data.errorCode,
      };
    }),
  );
}

/**
 * Check the status of a UPI autopay mandate.
 */
export async function checkUpiMandateStatus(mandateId: string): Promise<UpiAutopayMandate> {
  assertUpiEnabled();

  return withRetry(() =>
    upiBreaker.call(async () => {
      const res = await fetchWithTimeout(`${UPI_BASE_URL}/v1/mandates/${mandateId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${UPI_API_KEY}` },
      });

      handleResponseError(res, "UPI mandate status check", "upi-autopay");

      const data = (await res.json()) as {
        mandateId: string;
        vpa: string;
        maxAmount: number;
        frequency: string;
        status: string;
        createdAt: string;
      };

      return {
        mandateId: data.mandateId,
        vpa: data.vpa,
        maxAmount: BigInt(data.maxAmount),
        frequency: data.frequency as UpiAutopayMandate["frequency"],
        status: data.status as UpiAutopayMandate["status"],
        createdAt: data.createdAt,
      };
    }),
  );
}

// ── e-Mandate Public API ──────────────────────────────────────────

/**
 * Register a new e-mandate (NACH-based recurring debit).
 */
export async function registerEmandate(params: {
  accountNumber: string;
  ifsc: string;
  maxAmountPaise: bigint;
  frequency: EmandateRegistration["frequency"];
  tenantId: string;
}): Promise<EmandateRegistration> {
  assertEmandateEnabled();

  return withRetry(() =>
    emandateBreaker.call(async () => {
      const res = await fetchWithTimeout(`${EMANDATE_BASE_URL}/v1/mandates`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EMANDATE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountNumber: params.accountNumber,
          ifsc: params.ifsc,
          maxAmount: Number(params.maxAmountPaise),
          frequency: params.frequency,
          tenantId: params.tenantId,
        }),
      });

      handleResponseError(res, "e-mandate registration", "e-mandate");

      const data = (await res.json()) as {
        mandateId: string;
        status: string;
        createdAt: string;
      };

      return {
        mandateId: data.mandateId,
        accountNumber: params.accountNumber,
        ifsc: params.ifsc,
        maxAmount: params.maxAmountPaise,
        frequency: params.frequency,
        status: (data.status as EmandateRegistration["status"]) ?? "pending",
        createdAt: data.createdAt ?? new Date().toISOString(),
      };
    }),
  );
}

/**
 * Execute a debit against an existing e-mandate.
 */
export async function executeEmandateDebit(params: {
  mandateId: string;
  amountPaise: bigint;
  tenantId: string;
}): Promise<EmandateExecution> {
  assertEmandateEnabled();

  return withRetry(() =>
    emandateBreaker.call(async () => {
      const res = await fetchWithTimeout(`${EMANDATE_BASE_URL}/v1/mandates/${params.mandateId}/debit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EMANDATE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: Number(params.amountPaise),
          tenantId: params.tenantId,
        }),
      });

      handleResponseError(res, "e-mandate debit execution", "e-mandate");

      const data = (await res.json()) as {
        executionId: string;
        status: string;
        executedAt: string;
        errorCode?: string;
      };

      return {
        executionId: data.executionId,
        mandateId: params.mandateId,
        amount: params.amountPaise,
        status: (data.status as EmandateExecution["status"]) ?? "initiated",
        executedAt: data.executedAt ?? new Date().toISOString(),
        errorCode: data.errorCode,
      };
    }),
  );
}

/**
 * Check the status of an e-mandate registration.
 */
export async function checkEmandateStatus(mandateId: string): Promise<EmandateRegistration> {
  assertEmandateEnabled();

  return withRetry(() =>
    emandateBreaker.call(async () => {
      const res = await fetchWithTimeout(`${EMANDATE_BASE_URL}/v1/mandates/${mandateId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${EMANDATE_API_KEY}` },
      });

      handleResponseError(res, "e-mandate status check", "e-mandate");

      const data = (await res.json()) as {
        mandateId: string;
        accountNumber: string;
        ifsc: string;
        maxAmount: number;
        frequency: string;
        status: string;
        createdAt: string;
      };

      return {
        mandateId: data.mandateId,
        accountNumber: data.accountNumber,
        ifsc: data.ifsc,
        maxAmount: BigInt(data.maxAmount),
        frequency: data.frequency as EmandateRegistration["frequency"],
        status: data.status as EmandateRegistration["status"],
        createdAt: data.createdAt,
      };
    }),
  );
}

// ── Status helpers ────────────────────────────────────────────────

export function isUpiEnabled(): boolean {
  return UPI_ENABLED && UPI_BASE_URL.length > 0;
}

export function isEmandateEnabled(): boolean {
  return EMANDATE_ENABLED && EMANDATE_BASE_URL.length > 0;
}

export { CircuitBreakerOpenError };
