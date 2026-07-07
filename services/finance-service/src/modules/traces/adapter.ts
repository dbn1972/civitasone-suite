/**
 * TRACES adapter — Government Rail integration for TDS return filing,
 * PAN verification, and Form 16 download.
 *
 * Env-gated: fails closed when TRACES_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   TRACES_ENABLED   — "true" to activate; anything else → fail-closed
 *   TRACES_BASE_URL  — Base URL for the TRACES API
 *   TRACES_API_KEY   — API key for authentication
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface TdsReturnPayload {
  tanNumber: string;
  formType: "24Q" | "26Q" | "27Q" | "27EQ";
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  financialYear: string;
  deductees: Array<{
    pan: string;
    name: string;
    amountPaidMinor: bigint;
    tdsDeductedMinor: bigint;
    section: string;
  }>;
}

export interface TdsReturnResult {
  tokenNumber: string;
  status: "accepted" | "pending_validation";
  submittedAt: string;
}

export interface PanStatusResult {
  pan: string;
  status: "valid" | "invalid" | "inactive" | "not_found";
  name?: string | undefined;
  lastVerifiedAt: string;
}

export interface Form16Params {
  tanNumber: string;
  pan: string;
  financialYear: string;
  quarter?: "Q1" | "Q2" | "Q3" | "Q4";
}

export interface Form16Result {
  downloadUrl: string;
  fileFormat: "pdf";
  generatedAt: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class TracesAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "TracesAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.TRACES_ENABLED === "true";
const BASE_URL = process.env.TRACES_BASE_URL ?? "";
const API_KEY = process.env.TRACES_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.TRACES_TIMEOUT_MS ?? "15000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "traces",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new TracesAdapterError(
      "TRACES integration is not available",
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
 * Submit a TDS return to TRACES.
 *
 * Throws TracesAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function submitTdsReturn(payload: TdsReturnPayload): Promise<TdsReturnResult> {
  assertEnabled();

  return breaker.call(async () => {
    const body = {
      tanNumber: payload.tanNumber,
      formType: payload.formType,
      quarter: payload.quarter,
      financialYear: payload.financialYear,
      deductees: payload.deductees.map((d) => ({
        pan: d.pan,
        name: d.name,
        amountPaid: d.amountPaidMinor.toString(),
        tdsDeducted: d.tdsDeductedMinor.toString(),
        section: d.section,
      })),
    };

    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/tds-returns`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      throw new TracesAdapterError(
        `TRACES API returned ${res.status}`,
        "TRACES_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      tokenNumber?: string;
      status?: string;
      submittedAt?: string;
    };

    return {
      tokenNumber: data.tokenNumber ?? "",
      status: (data.status === "accepted" ? "accepted" : "pending_validation"),
      submittedAt: data.submittedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Verify a PAN status via TRACES.
 *
 * Throws TracesAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function verifyPanStatus(pan: string): Promise<PanStatusResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/pan-status/${encodeURIComponent(pan)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new TracesAdapterError(
        `TRACES API returned ${res.status}`,
        "TRACES_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      pan?: string;
      status?: string;
      name?: string;
      lastVerifiedAt?: string;
    };

    const validStatuses = ["valid", "invalid", "inactive", "not_found"] as const;
    const status = validStatuses.includes(data.status as typeof validStatuses[number])
      ? (data.status as PanStatusResult["status"])
      : "not_found";

    return {
      pan: data.pan ?? pan,
      status,
      name: data.name,
      lastVerifiedAt: data.lastVerifiedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Download Form 16 from TRACES.
 *
 * Throws TracesAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function downloadForm16(params: Form16Params): Promise<Form16Result> {
  assertEnabled();

  return breaker.call(async () => {
    const queryParts: string[] = [
      `tan=${encodeURIComponent(params.tanNumber)}`,
      `pan=${encodeURIComponent(params.pan)}`,
      `fy=${encodeURIComponent(params.financialYear)}`,
    ];
    if (params.quarter) {
      queryParts.push(`quarter=${encodeURIComponent(params.quarter)}`);
    }

    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/form16?${queryParts.join("&")}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new TracesAdapterError(
        `TRACES API returned ${res.status}`,
        "TRACES_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      downloadUrl?: string;
      fileFormat?: string;
      generatedAt?: string;
    };

    return {
      downloadUrl: data.downloadUrl ?? "",
      fileFormat: "pdf",
      generatedAt: data.generatedAt ?? new Date().toISOString(),
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
