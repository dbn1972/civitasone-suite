/**
 * NIC e-Invoice API client — mock-first implementation.
 *
 * In dev/test (EINVOICE_MODE=mock, the default): returns deterministic mock
 * responses without hitting NIC. In production: uses OAuth2 client_credentials
 * flow against the NIC e-Invoice sandbox/production endpoints.
 */

// ── Types ─────────────────────────────────────────────────────────

export type EInvoicePayload = {
  version: "1.1";
  tranDtls: { taxSch: "GST"; supTyp: "B2B" | "B2C" | "SEZWP" | "SEZWOP" | "EXPWP" | "EXPWOP"; regRev: "N" };
  docDtls: { typ: "INV" | "CRN" | "DBN"; no: string; dt: string };
  sellerDtls: { gstin: string; lglNm: string; addr1: string; loc: string; pin: number; stcd: string };
  buyerDtls: { gstin: string; lglNm: string; addr1: string; loc: string; pin: number; stcd: string; pos: string };
  itemList: Array<{
    slNo: string; prdDesc: string; isServc: "Y" | "N"; hsnCd: string;
    qty: number; unit: string; unitPrice: number; totAmt: number;
    gstRt: number; igstAmt: number; cgstAmt: number; sgstAmt: number;
    totItemVal: number;
  }>;
  valDtls: { assVal: number; cgstVal: number; sgstVal: number; igstVal: number; totInvVal: number };
};

export type GenerateIrnResponse = {
  irn: string;
  ackNo: string;
  ackDate: string;
  signedInvoice: string;
  signedQrCode: string;
};

export type CancelIrnResponse = {
  success: boolean;
  cancelDate: string;
};

export type GetIrnResponse = {
  irn: string;
  ackNo: string;
  ackDate: string;
  status: string;
  docNo: string;
};

// ── Config ────────────────────────────────────────────────────────

const EINVOICE_MODE = process.env.EINVOICE_MODE ?? "mock";
const EINVOICE_API_URL = process.env.EINVOICE_API_URL ?? "https://einv-apisandbox.nic.in";
const EINVOICE_CLIENT_ID = process.env.EINVOICE_CLIENT_ID ?? "";
const EINVOICE_CLIENT_SECRET = process.env.EINVOICE_CLIENT_SECRET ?? "";
const EINVOICE_GSTIN = process.env.EINVOICE_GSTIN ?? "";

// ── Token cache (1h TTL) ──────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch(`${EINVOICE_API_URL}/eivital/v1.04/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "client_id": EINVOICE_CLIENT_ID,
      "client_secret": EINVOICE_CLIENT_SECRET,
      "gstin": EINVOICE_GSTIN,
    },
    body: JSON.stringify({
      userName: EINVOICE_CLIENT_ID,
      password: EINVOICE_CLIENT_SECRET,
      appKey: EINVOICE_CLIENT_ID,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NIC auth failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { authToken: string; tokenExpiry: number };
  // NIC returns tokenExpiry in seconds; cache with 5-minute safety margin
  const ttlMs = (data.tokenExpiry - 300) * 1000;
  cachedToken = { token: data.authToken, expiresAt: Date.now() + ttlMs };
  return cachedToken.token;
}

// ── Mock helpers ──────────────────────────────────────────────────

function mockIrn(docNo: string): string {
  // Deterministic 64-char hex string based on doc number
  const base = docNo.replace(/[^a-zA-Z0-9]/g, "").padEnd(64, "0");
  return base.slice(0, 64);
}

function mockGenerateResponse(payload: EInvoicePayload): GenerateIrnResponse {
  const now = new Date().toISOString();
  return {
    irn: mockIrn(payload.docDtls.no),
    ackNo: `1234567890${payload.docDtls.no.slice(-4)}`,
    ackDate: now,
    signedInvoice: JSON.stringify({ ...payload, irn: mockIrn(payload.docDtls.no) }),
    signedQrCode: `mock-qr-${payload.docDtls.no}`,
  };
}

// ── Public API ────────────────────────────────────────────────────

export async function generateIrn(payload: EInvoicePayload): Promise<GenerateIrnResponse> {
  if (EINVOICE_MODE === "mock") {
    return mockGenerateResponse(payload);
  }

  const token = await getAuthToken();
  const res = await fetch(`${EINVOICE_API_URL}/eicore/v1.03/Invoice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "gstin": EINVOICE_GSTIN,
      "client_id": EINVOICE_CLIENT_ID,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NIC generateIrn failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    Irn: string; AckNo: string; AckDt: string; SignedInvoice: string; SignedQRCode: string;
  };

  return {
    irn: data.Irn,
    ackNo: data.AckNo,
    ackDate: data.AckDt,
    signedInvoice: data.SignedInvoice,
    signedQrCode: data.SignedQRCode,
  };
}

export async function cancelIrn(irn: string, reason: string): Promise<CancelIrnResponse> {
  if (EINVOICE_MODE === "mock") {
    return { success: true, cancelDate: new Date().toISOString() };
  }

  const token = await getAuthToken();
  const res = await fetch(`${EINVOICE_API_URL}/eicore/v1.03/Invoice/Cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "gstin": EINVOICE_GSTIN,
      "client_id": EINVOICE_CLIENT_ID,
    },
    body: JSON.stringify({ Irn: irn, CnlRsn: "1", CnlRem: reason }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NIC cancelIrn failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { CancelDate: string };
  return { success: true, cancelDate: data.CancelDate };
}

export async function getIrnByDocNo(gstin: string, docNo: string, fy: string): Promise<GetIrnResponse> {
  if (EINVOICE_MODE === "mock") {
    return {
      irn: mockIrn(docNo),
      ackNo: `1234567890${docNo.slice(-4)}`,
      ackDate: new Date().toISOString(),
      status: "ACT",
      docNo,
    };
  }

  const token = await getAuthToken();
  const res = await fetch(`${EINVOICE_API_URL}/eicore/v1.03/Invoice/irnbydocdetails?doctype=INV&docnum=${encodeURIComponent(docNo)}&docdate=${fy}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "gstin": gstin,
      "client_id": EINVOICE_CLIENT_ID,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NIC getIrnByDocNo failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { Irn: string; AckNo: string; AckDt: string; Status: string; DocNo: string };
  return {
    irn: data.Irn,
    ackNo: data.AckNo,
    ackDate: data.AckDt,
    status: data.Status,
    docNo: data.DocNo,
  };
}
