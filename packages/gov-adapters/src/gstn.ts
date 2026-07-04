/**
 * GSTN (Goods and Services Tax Network) adapter for GSTR-1 / GSTR-3B filing.
 *
 * Env-gated: defaults to mock mode. In production, calls the GST Suvidha Provider
 * (GSP) API for return filing and status checks.
 *
 * Env vars:
 *   GSTN_MODE           — "mock" (default) | "sandbox" | "production"
 *   GSTN_GSP_URL        — GSP API base URL
 *   GSTN_CLIENT_ID      — OAuth client ID
 *   GSTN_CLIENT_SECRET  — OAuth client secret
 *   GSTN_GSTIN          — filing entity GSTIN
 */

// ── Types ─────────────────────────────────────────────────────────

export interface Gstr1Invoice {
  invoiceNo: string;
  invoiceDate: string; // DD/MM/YYYY
  recipientGstin: string;
  recipientName: string;
  hsnCode: string;
  taxableValueMinor: bigint;
  igstMinor: bigint;
  cgstMinor: bigint;
  sgstMinor: bigint;
  totalMinor: bigint;
  placeOfSupply: string; // state code
}

export interface Gstr1Request {
  gstin?: string;
  financialYear: string;
  period: string; // MMYYYY
  invoices: Gstr1Invoice[];
}

export interface Gstr3BLiability {
  igstMinor: bigint;
  cgstMinor: bigint;
  sgstMinor: bigint;
  cessMinor: bigint;
}

export interface Gstr3BRequest {
  gstin?: string;
  period: string; // MMYYYY
  outwardSupplies: Gstr3BLiability;
  itcClaimed: Gstr3BLiability;
  taxPayable: Gstr3BLiability;
}

export interface GstnFilingResponse {
  referenceId: string;
  status: "accepted" | "pending" | "error";
  ackNo?: string | undefined;
  errors?: Array<{ code: string; message: string }> | undefined;
  timestamp: string;
}

export interface GstnStatusResponse {
  referenceId: string;
  status: "filed" | "pending" | "rejected";
  ackNo?: string | undefined;
  rejectionReasons?: string[] | undefined;
}

export class GstnAdapterError extends Error {
  constructor(message: string, public readonly code: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "GstnAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const MODE = (process.env.GSTN_MODE ?? "mock") as "mock" | "sandbox" | "production";
const GSP_URL = process.env.GSTN_GSP_URL ?? "https://gsp.example.com/api";
const CLIENT_ID = process.env.GSTN_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GSTN_CLIENT_SECRET ?? "";
const GSTIN = process.env.GSTN_GSTIN ?? "";

function assertConfigured(): void {
  if (MODE === "mock") return;
  if (!CLIENT_ID || !CLIENT_SECRET || !GSTIN) {
    throw new GstnAdapterError(
      "GSTN adapter is not configured. Set GSTN_CLIENT_ID, GSTN_CLIENT_SECRET, and GSTN_GSTIN.",
      "GSTN_NOT_CONFIGURED",
    );
  }
}

// ── Token management ──────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch(`${GSP_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new GstnAdapterError(`GSTN auth failed (${res.status})`, "GSTN_AUTH_FAILED", res.status);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

// ── Mock ──────────────────────────────────────────────────────────

function mockFiling(type: string): GstnFilingResponse {
  return {
    referenceId: `${type}-MOCK-${Date.now()}`,
    status: "accepted",
    ackNo: `ACK${Date.now()}`,
    timestamp: new Date().toISOString(),
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * File GSTR-1 (outward supplies return).
 */
export async function fileGstr1(req: Gstr1Request): Promise<GstnFilingResponse> {
  assertConfigured();
  if (MODE === "mock") return mockFiling("GSTR1");

  const gstin = req.gstin ?? GSTIN;
  const token = await getAuthToken();

  const payload = {
    gstin,
    fp: req.period,
    b2b: req.invoices.map((inv) => ({
      ctin: inv.recipientGstin,
      inv: [{
        inum: inv.invoiceNo,
        idt: inv.invoiceDate,
        val: Number(inv.totalMinor) / 100,
        pos: inv.placeOfSupply,
        itms: [{
          num: 1,
          itm_det: {
            txval: Number(inv.taxableValueMinor) / 100,
            iamt: Number(inv.igstMinor) / 100,
            camt: Number(inv.cgstMinor) / 100,
            samt: Number(inv.sgstMinor) / 100,
          },
        }],
      }],
    })),
  };

  const res = await fetch(`${GSP_URL}/returns/gstr1`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "gstin": gstin,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new GstnAdapterError(`GSTR-1 filing failed (${res.status}): ${text}`, "GSTN_API_ERROR", res.status);
  }

  const data = await res.json() as { reference_id: string; status_cd: string; ack_num?: string };
  return {
    referenceId: data.reference_id,
    status: data.status_cd === "P" ? "accepted" : "pending",
    ackNo: data.ack_num,
    timestamp: new Date().toISOString(),
  };
}

/**
 * File GSTR-3B (summary return with tax payment).
 */
export async function fileGstr3B(req: Gstr3BRequest): Promise<GstnFilingResponse> {
  assertConfigured();
  if (MODE === "mock") return mockFiling("GSTR3B");

  const gstin = req.gstin ?? GSTIN;
  const token = await getAuthToken();

  const toRupees = (minor: bigint) => Number(minor) / 100;
  const payload = {
    gstin,
    ret_period: req.period,
    sup_details: {
      osup_det: {
        iamt: toRupees(req.outwardSupplies.igstMinor),
        camt: toRupees(req.outwardSupplies.cgstMinor),
        samt: toRupees(req.outwardSupplies.sgstMinor),
        csamt: toRupees(req.outwardSupplies.cessMinor),
      },
    },
    itc_elg: {
      itc_avl: [{
        iamt: toRupees(req.itcClaimed.igstMinor),
        camt: toRupees(req.itcClaimed.cgstMinor),
        samt: toRupees(req.itcClaimed.sgstMinor),
        csamt: toRupees(req.itcClaimed.cessMinor),
      }],
    },
  };

  const res = await fetch(`${GSP_URL}/returns/gstr3b`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "gstin": gstin,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new GstnAdapterError(`GSTR-3B filing failed (${res.status}): ${text}`, "GSTN_API_ERROR", res.status);
  }

  const data = await res.json() as { reference_id: string; status_cd: string; ack_num?: string };
  return {
    referenceId: data.reference_id,
    status: data.status_cd === "P" ? "accepted" : "pending",
    ackNo: data.ack_num,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check filing status.
 */
export async function checkFilingStatus(referenceId: string): Promise<GstnStatusResponse> {
  assertConfigured();
  if (MODE === "mock") {
    return { referenceId, status: "filed", ackNo: `ACK${Date.now()}` };
  }

  const token = await getAuthToken();
  const res = await fetch(`${GSP_URL}/returns/status?ref_id=${encodeURIComponent(referenceId)}`, {
    headers: { "Authorization": `Bearer ${token}`, "gstin": GSTIN },
  });

  if (!res.ok) {
    throw new GstnAdapterError(`GSTN status check failed (${res.status})`, "GSTN_API_ERROR", res.status);
  }

  const data = await res.json() as { ref_id: string; status: string; ack_num?: string; error_msg?: string[] };
  return {
    referenceId: data.ref_id,
    status: data.status === "IP" ? "pending" : data.status === "P" ? "filed" : "rejected",
    ackNo: data.ack_num,
    rejectionReasons: data.error_msg,
  };
}

/** Returns true if the adapter is configured for real (non-mock) calls. */
export function isConfigured(): boolean {
  return MODE !== "mock" && CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}
