/**
 * PFMS (Public Financial Management System) e-Kuber adapter.
 *
 * Env-gated: defaults to mock mode. In production, calls the PFMS sandbox/prod
 * API for disbursement initiation and status reconciliation.
 *
 * Env vars:
 *   PFMS_MODE          — "mock" (default) | "sandbox" | "production"
 *   PFMS_API_URL       — base URL (e.g. https://pfms.nic.in/api)
 *   PFMS_AGENCY_CODE   — registered agency code
 *   PFMS_AUTH_TOKEN    — bearer token or API key
 *   PFMS_SCHEME_CODE   — default scheme code for disbursements
 *
 * Fail-closed: if env vars are missing in non-mock mode, all calls throw.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface PfmsDisbursementRequest {
  /** Unique transaction reference from our system */
  txnRef: string;
  /** Scheme code (PFMS-registered) */
  schemeCode: string;
  /** Amount in paise (bigint) */
  amountMinor: bigint;
  /** Currency (always INR for PFMS) */
  currency: "INR";
  /** Beneficiary details */
  beneficiary: {
    name: string;
    bankAccount: string;
    ifsc: string;
    aadhaarHash?: string;
  };
  /** Purpose/narration */
  narration: string;
}

export interface PfmsDisbursementResponse {
  /** PFMS-assigned transaction ID */
  pfmsTxnId: string;
  /** Status: initiated, queued, rejected */
  status: "initiated" | "queued" | "rejected";
  /** Rejection reason (if status=rejected) */
  reason?: string | undefined;
  /** Timestamp from PFMS */
  timestamp: string;
}

export interface PfmsStatusRequest {
  pfmsTxnId: string;
}

export interface PfmsStatusResponse {
  pfmsTxnId: string;
  status: "pending" | "completed" | "failed" | "reversed";
  utrNo?: string | undefined;
  completedAt?: string | undefined;
  failureReason?: string | undefined;
}

// ── Config ────────────────────────────────────────────────────────

const MODE = (process.env.PFMS_MODE ?? "mock") as "mock" | "sandbox" | "production";
const API_URL = process.env.PFMS_API_URL ?? "https://pfms.nic.in/api";
const AGENCY_CODE = process.env.PFMS_AGENCY_CODE ?? "";
const AUTH_TOKEN = process.env.PFMS_AUTH_TOKEN ?? "";

function assertConfigured(): void {
  if (MODE === "mock") return;
  if (!AGENCY_CODE || !AUTH_TOKEN) {
    throw new PfmsAdapterError(
      "PFMS adapter is not configured. Set PFMS_AGENCY_CODE and PFMS_AUTH_TOKEN.",
      "PFMS_NOT_CONFIGURED",
    );
  }
}

// ── Error ─────────────────────────────────────────────────────────

export class PfmsAdapterError extends Error {
  constructor(message: string, public readonly code: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "PfmsAdapterError";
  }
}

// ── Mock Implementation ───────────────────────────────────────────

function mockDisburse(req: PfmsDisbursementRequest): PfmsDisbursementResponse {
  return {
    pfmsTxnId: `PFMS-${req.txnRef}`,
    status: "initiated",
    timestamp: new Date().toISOString(),
  };
}

function mockStatus(req: PfmsStatusRequest): PfmsStatusResponse {
  return {
    pfmsTxnId: req.pfmsTxnId,
    status: "completed",
    utrNo: `UTR${Date.now()}`,
    completedAt: new Date().toISOString(),
  };
}

// ── Real Implementation ───────────────────────────────────────────

async function realDisburse(req: PfmsDisbursementRequest): Promise<PfmsDisbursementResponse> {
  const body = {
    agencyCode: AGENCY_CODE,
    schemeCode: req.schemeCode,
    txnRef: req.txnRef,
    amount: Number(req.amountMinor) / 100, // PFMS expects rupees
    beneficiaryName: req.beneficiary.name,
    accountNo: req.beneficiary.bankAccount,
    ifscCode: req.beneficiary.ifsc,
    aadhaarHash: req.beneficiary.aadhaarHash,
    narration: req.narration,
  };

  const res = await fetch(`${API_URL}/v1/disbursement/initiate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AUTH_TOKEN}`,
      "X-Agency-Code": AGENCY_CODE,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new PfmsAdapterError(
      `PFMS disbursement failed (${res.status}): ${text}`,
      "PFMS_API_ERROR",
      res.status,
    );
  }

  const data = await res.json() as { txnId: string; status: string; reason?: string; timestamp: string };
  return {
    pfmsTxnId: data.txnId,
    status: data.status === "REJ" ? "rejected" : data.status === "QUE" ? "queued" : "initiated",
    reason: data.reason,
    timestamp: data.timestamp,
  };
}

async function realStatus(req: PfmsStatusRequest): Promise<PfmsStatusResponse> {
  const res = await fetch(`${API_URL}/v1/disbursement/status?txnId=${encodeURIComponent(req.pfmsTxnId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${AUTH_TOKEN}`,
      "X-Agency-Code": AGENCY_CODE,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new PfmsAdapterError(
      `PFMS status check failed (${res.status}): ${text}`,
      "PFMS_API_ERROR",
      res.status,
    );
  }

  const data = await res.json() as { txnId: string; status: string; utrNo?: string; completedAt?: string; failureReason?: string };
  const statusMap: Record<string, PfmsStatusResponse["status"]> = {
    PEN: "pending", COM: "completed", FAI: "failed", REV: "reversed",
  };
  return {
    pfmsTxnId: data.txnId,
    status: statusMap[data.status] ?? "pending",
    utrNo: data.utrNo,
    completedAt: data.completedAt,
    failureReason: data.failureReason,
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Initiate a disbursement via PFMS e-Kuber.
 * In mock mode, returns a synthetic response. In production, calls the real API.
 */
export async function initiateDisbursement(req: PfmsDisbursementRequest): Promise<PfmsDisbursementResponse> {
  assertConfigured();
  if (MODE === "mock") return mockDisburse(req);
  return realDisburse(req);
}

/**
 * Check disbursement status via PFMS.
 * In mock mode, always returns "completed". In production, calls the real API.
 */
export async function checkDisbursementStatus(req: PfmsStatusRequest): Promise<PfmsStatusResponse> {
  assertConfigured();
  if (MODE === "mock") return mockStatus(req);
  return realStatus(req);
}

/** Returns true if the adapter is configured for real (non-mock) calls. */
export function isConfigured(): boolean {
  return MODE !== "mock" && AGENCY_CODE.length > 0 && AUTH_TOKEN.length > 0;
}
