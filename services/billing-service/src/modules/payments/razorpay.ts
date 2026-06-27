import { createHmac, timingSafeEqual } from "node:crypto";

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

function getKeyId(): string {
  const key = process.env.RAZORPAY_KEY_ID;
  if (!key) throw new Error("RAZORPAY_KEY_ID is not set");
  return key;
}

function getKeySecret(): string {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error("RAZORPAY_KEY_SECRET is not set");
  return secret;
}

function getWebhookSecret(): string {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not set");
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
 */
export async function createOrder(
  amountPaise: number,
  currency: string,
  receipt: string,
  notes?: Record<string, string>,
): Promise<RazorpayOrder> {
  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency,
      receipt,
      ...(notes ? { notes } : {}),
    }),
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
