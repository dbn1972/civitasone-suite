/**
 * Telephony carrier adapter — env-gated integration with Twilio or Exotel.
 *
 * In mock mode (default): returns synthetic responses, no outbound calls placed.
 * In production: calls the real carrier API for click-to-call, IVR setup, and
 * inbound webhook registration.
 *
 * Env vars:
 *   TELEPHONY_CARRIER     — "mock" (default) | "twilio" | "exotel"
 *   TWILIO_ACCOUNT_SID    — Twilio account SID
 *   TWILIO_AUTH_TOKEN     — Twilio auth token
 *   TWILIO_FROM_NUMBER    — default outbound number (+91...)
 *   EXOTEL_SID            — Exotel SID
 *   EXOTEL_API_KEY        — Exotel API key
 *   EXOTEL_API_TOKEN      — Exotel API token
 *   EXOTEL_SUBDOMAIN      — Exotel subdomain (e.g. api.exotel.com)
 *   CARRIER_WEBHOOK_BASE  — public URL for inbound webhooks
 */

// ── Types ─────────────────────────────────────────────────────────

export interface DialRequest {
  from: string;
  to: string;
  callbackUrl?: string;
  statusCallbackUrl?: string;
  recordCall?: boolean;
  timeout?: number;
}

export interface DialResponse {
  carrierCallId: string;
  status: "queued" | "ringing" | "failed";
  carrier: string;
}

export interface HangupRequest {
  carrierCallId: string;
}

export interface WebhookRegistration {
  /** Public URL where inbound call webhooks should be sent */
  inboundUrl: string;
  /** Public URL for status callbacks */
  statusUrl: string;
}

export class CarrierAdapterError extends Error {
  constructor(message: string, public readonly code: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "CarrierAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

type CarrierType = "mock" | "twilio" | "exotel";
const CARRIER = (process.env.TELEPHONY_CARRIER ?? "mock") as CarrierType;
const WEBHOOK_BASE = process.env.CARRIER_WEBHOOK_BASE ?? "https://api.civitasone.in";

function assertConfigured(): void {
  if (CARRIER === "mock") return;
  if (CARRIER === "twilio") {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new CarrierAdapterError("Twilio not configured (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)", "CARRIER_NOT_CONFIGURED");
    }
  }
  if (CARRIER === "exotel") {
    if (!process.env.EXOTEL_SID || !process.env.EXOTEL_API_KEY) {
      throw new CarrierAdapterError("Exotel not configured (set EXOTEL_SID + EXOTEL_API_KEY)", "CARRIER_NOT_CONFIGURED");
    }
  }
}

// ── Mock ──────────────────────────────────────────────────────────

function mockDial(req: DialRequest): DialResponse {
  return {
    carrierCallId: `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "queued",
    carrier: "mock",
  };
}

// ── Twilio ────────────────────────────────────────────────────────

async function twilioDial(req: DialRequest): Promise<DialResponse> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = req.from || process.env.TWILIO_FROM_NUMBER || "";

  const params = new URLSearchParams({
    To: req.to,
    From: from,
    Url: req.callbackUrl ?? `${WEBHOOK_BASE}/v1/telephony/webhooks/twilio/voice`,
    StatusCallback: req.statusCallbackUrl ?? `${WEBHOOK_BASE}/v1/telephony/webhooks/twilio/status`,
    Record: req.recordCall ? "true" : "false",
    Timeout: String(req.timeout ?? 30),
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new CarrierAdapterError(`Twilio dial failed (${res.status}): ${text}`, "TWILIO_ERROR", res.status);
  }

  const data = await res.json() as { sid: string; status: string };
  return {
    carrierCallId: data.sid,
    status: data.status === "queued" ? "queued" : data.status === "ringing" ? "ringing" : "queued",
    carrier: "twilio",
  };
}

// ── Exotel ────────────────────────────────────────────────────────

async function exotelDial(req: DialRequest): Promise<DialResponse> {
  const sid = process.env.EXOTEL_SID!;
  const apiKey = process.env.EXOTEL_API_KEY!;
  const apiToken = process.env.EXOTEL_API_TOKEN ?? "";
  const subdomain = process.env.EXOTEL_SUBDOMAIN ?? "api.exotel.com";
  const from = req.from || process.env.EXOTEL_CALLER_ID || "";

  const params = new URLSearchParams({
    From: from,
    To: req.to,
    CallerId: from,
    StatusCallback: req.statusCallbackUrl ?? `${WEBHOOK_BASE}/v1/telephony/webhooks/exotel/status`,
    Record: req.recordCall ? "true" : "false",
    TimeLimit: String((req.timeout ?? 30) * 60),
  });

  const res = await fetch(`https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString("base64")}`,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new CarrierAdapterError(`Exotel dial failed (${res.status}): ${text}`, "EXOTEL_ERROR", res.status);
  }

  const data = await res.json() as { Call?: { Sid?: string; Status?: string } };
  return {
    carrierCallId: data.Call?.Sid ?? `EXO-${Date.now()}`,
    status: "queued",
    carrier: "exotel",
  };
}

// ── Public API ────────────────────────────────────────────────────

/** Place an outbound call via the configured carrier. */
export async function dial(req: DialRequest): Promise<DialResponse> {
  assertConfigured();
  switch (CARRIER) {
    case "mock": return mockDial(req);
    case "twilio": return twilioDial(req);
    case "exotel": return exotelDial(req);
  }
}

/** Hang up an active call. */
export async function hangup(req: HangupRequest): Promise<void> {
  assertConfigured();
  if (CARRIER === "mock") return;

  if (CARRIER === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${req.carrierCallId}.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      },
      body: "Status=completed",
    });
  }
  // Exotel doesn't have a standard hangup API — calls end via IVR flow
}

/** Get webhook URLs for carrier configuration. */
export function getWebhookUrls(): WebhookRegistration {
  const prefix = CARRIER === "exotel" ? "exotel" : "twilio";
  return {
    inboundUrl: `${WEBHOOK_BASE}/v1/telephony/webhooks/${prefix}/inbound`,
    statusUrl: `${WEBHOOK_BASE}/v1/telephony/webhooks/${prefix}/status`,
  };
}

/** Returns the active carrier name. */
export function getCarrier(): CarrierType { return CARRIER; }

/** Returns true if a real carrier is configured. */
export function isConfigured(): boolean { return CARRIER !== "mock"; }
