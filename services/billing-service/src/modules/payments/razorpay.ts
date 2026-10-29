import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../../shared/context.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/**
 * UAT g3 #17: an unset RAZORPAY_* var used to surface as an unhandled 500. It is an
 * operator/config condition, not a server bug: answer 503 with a stable code so callers
 * (and monitoring) can tell "gateway not configured" from a crash. Fails closed.
 */
export function notConfigured(envName: string): HttpError {
  return new HttpError(503, "PAYMENT_GATEWAY_NOT_CONFIGURED", `${envName} is not set`);
}

function getKeyId(): string {
  const key = process.env.RAZORPAY_KEY_ID;
  if (!key) throw notConfigured("RAZORPAY_KEY_ID");
  return key;
}

function getKeySecret(): string {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw notConfigured("RAZORPAY_KEY_SECRET");
  return secret;
}

function getWebhookSecret(): string {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw notConfigured("RAZORPAY_WEBHOOK_SECRET");
  return secret;
}

function authHeader(): string {
  const credentials = Buffer.from(`${getKeyId()}:${getKeySecret()}`).toString("base64");
  return `Basic ${credentials}`;
}

// ---------------------------------------------------------------------------
// SDK wrapper — uses plain fetch (no npm dependency)
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.razorpay.com/v1";

/**
 * Create a Razorpay order. The frontend uses the returned order_id to launch
 * the Checkout.js modal.
 *
 * GAP2-BILLING-CHECKOUT-01: `amountPaise` is a bigint (paise / minor units) end
 * to end — never a JS float. Razorpay's JSON API expects `amount` as an integer
 * number, so we serialise the bigint as a bare integer token in the request
 * body (JSON.stringify cannot encode a bigint, and Number(bigint) would reintroduce
 * the IEEE-754 precision loss this fix exists to remove). Building the body with
 * the amount injected as an exact integer literal keeps the charged amount
 * precise even above Number.MAX_SAFE_INTEGER paise.
 */
export async function createOrder(
  amountPaise: bigint,
  currency: string,
  receipt: string,
  notes?: Record<string, string>,
): Promise<RazorpayOrder> {
  if (amountPaise < 0n) {
    throw new Error("Razorpay createOrder amount must be non-negative");
  }
  // Serialise the amount as an exact integer literal. `JSON.stringify` with a
  // sentinel placeholder, then substitute the bigint's decimal string, so the
  // wire value is a precise integer regardless of magnitude.
  const AMOUNT_SENTINEL = "__AMOUNT_PAISE__";
  const bodyTemplate = JSON.stringify({
    amount: AMOUNT_SENTINEL,
    currency,
    receipt,
    ...(notes ? { notes } : {}),
  });
  const body = bodyTemplate.replace(`"${AMOUNT_SENTINEL}"`, amountPaise.toString());

  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay createOrder failed (${res.status}): ${body}`);
  }

  return (await res.json()) as RazorpayOrder;
}

/**
 * Fetch payment details from Razorpay. Used for server-side confirmation.
 */
export async function fetchPayment(paymentId: string): Promise<RazorpayPayment> {
  const res = await fetch(`${BASE_URL}/payments/${paymentId}`, {
    method: "GET",
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay fetchPayment failed (${res.status}): ${body}`);
  }

  return (await res.json()) as RazorpayPayment;
}

/**
 * Verify the payment signature returned by Checkout.js.
 * Razorpay expects: HMAC-SHA256(orderId + "|" + paymentId, secret) === signature
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const expectedPayload = `${orderId}|${paymentId}`;
  const expected = createHmac("sha256", getKeySecret())
    .update(expectedPayload)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Verify the webhook signature sent by Razorpay in the X-Razorpay-Signature header.
 * HMAC-SHA256(rawBody, webhookSecret) === signature
 */
export function verifyWebhookSignature(body: string, signature: string): boolean {
  const expected = createHmac("sha256", getWebhookSecret())
    .update(body)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Export the key ID for returning to the frontend (used to initialize Checkout.js).
 */
export function getPublicKeyId(): string {
  return getKeyId();
}
