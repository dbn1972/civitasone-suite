/**
 * PayU payment gateway adapter.
 *
 * Implements the PaymentGateway interface for PayU India.
 * Uses plain fetch with timeout enforcement.
 *
 * Env vars:
 *   PAYU_MERCHANT_KEY  — Merchant key
 *   PAYU_SALT          — Salt for hash generation
 *   PAYU_BASE_URL      — API base URL (defaults to PayU sandbox)
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type {
  PaymentGateway,
  GatewayOrder,
  GatewayPaymentStatus,
  GatewayCaptureResult,
  GatewayRefundResult,
  OrderMetadata,
} from "./types.js";
import { GatewayError } from "./types.js";
import { minorToMajorString } from "@civitasone/schemas/money";

const BASE_URL = process.env.PAYU_BASE_URL ?? "https://sandboxsecure.payu.in";
const TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS ?? "10000");

function getMerchantKey(): string {
  const key = process.env.PAYU_MERCHANT_KEY;
  if (!key) throw new GatewayError("PAYU_MERCHANT_KEY is not set", "GATEWAY_NOT_CONFIGURED", "payu");
  return key;
}

function getSalt(): string {
  const salt = process.env.PAYU_SALT;
  if (!salt) throw new GatewayError("PAYU_SALT is not set", "GATEWAY_NOT_CONFIGURED", "payu");
  return salt;
}

function computeHash(data: string): string {
  return createHash("sha512").update(data).digest("hex");
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GatewayError("PayU request timed out", "GATEWAY_TIMEOUT", "payu");
    }
    throw new GatewayError("PayU network error", "GATEWAY_NETWORK_ERROR", "payu");
  } finally {
    clearTimeout(timer);
  }
}

export const payuAdapter: PaymentGateway = {
  name: "payu",

  async createOrder(amount: bigint, currency: string, metadata: OrderMetadata): Promise<GatewayOrder> {
    const txnId = `payu-${metadata.tenantId}-${Date.now()}`;
    const amountStr = minorToMajorString(amount); // PayU expects rupees
    const merchantKey = getMerchantKey();
    const salt = getSalt();

    // PayU hash: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
    const hashStr = `${merchantKey}|${txnId}|${amountStr}|CivitasOne Payment|Customer|customer@example.com|||||||||||${salt}`;
    const hash = computeHash(hashStr);

    const params = new URLSearchParams({
      key: merchantKey,
      txnid: txnId,
      amount: amountStr,
      productinfo: "CivitasOne Payment",
      firstname: "Customer",
      email: "customer@example.com",
      phone: "",
      surl: `${process.env.PAYU_SUCCESS_URL ?? "https://localhost/success"}`,
      furl: `${process.env.PAYU_FAILURE_URL ?? "https://localhost/failure"}`,
      hash,
    });

    const res = await fetchWithTimeout(`${BASE_URL}/_payment`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new GatewayError(
        `PayU createOrder failed (${res.status})`,
        "GATEWAY_CREATE_ORDER_FAILED",
        "payu",
        res.status,
      );
    }

    return {
      gatewayOrderId: txnId,
      gateway: "payu",
      amount,
      currency,
      status: "created",
      metadata,
      createdAt: new Date().toISOString(),
    };
  },

  async capturePayment(orderId: string): Promise<GatewayCaptureResult> {
    // PayU auto-captures — verify status to confirm
    const merchantKey = getMerchantKey();
    const salt = getSalt();
    const command = "verify_payment";
    const hashStr = `${merchantKey}|${command}|${orderId}|${salt}`;
    const hash = computeHash(hashStr);

    const params = new URLSearchParams({
      key: merchantKey,
      command,
      var1: orderId,
      hash,
    });

    const res = await fetchWithTimeout(`${BASE_URL}/merchant/postservice?form=2`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new GatewayError(
        `PayU capturePayment failed (${res.status})`,
        "GATEWAY_CAPTURE_FAILED",
        "payu",
        res.status,
      );
    }

    const data = (await res.json()) as {
      status: number;
      transaction_details: Record<string, { amt: string; status: string; mihpayid: string }>;
    };

    const txnDetails = data.transaction_details?.[orderId];
    if (!txnDetails) {
      throw new GatewayError("PayU transaction not found", "GATEWAY_NO_PAYMENT", "payu", 404);
    }

    const captured = txnDetails.status === "success";
    return {
      gatewayOrderId: orderId,
      gateway: "payu",
      capturedAmount: BigInt(Math.round(parseFloat(txnDetails.amt) * 100)),
      currency: "INR",
      status: captured ? "captured" : "failed",
      capturedAt: new Date().toISOString(),
      errorCode: captured ? undefined : "PAYMENT_NOT_CAPTURED",
      errorMessage: captured ? undefined : `PayU status: ${txnDetails.status}`,
    };
  },

  async checkStatus(orderId: string): Promise<GatewayPaymentStatus> {
    const merchantKey = getMerchantKey();
    const salt = getSalt();
    const command = "verify_payment";
    const hashStr = `${merchantKey}|${command}|${orderId}|${salt}`;
    const hash = computeHash(hashStr);

    const params = new URLSearchParams({
      key: merchantKey,
      command,
      var1: orderId,
      hash,
    });

    const res = await fetchWithTimeout(`${BASE_URL}/merchant/postservice?form=2`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new GatewayError(
        `PayU checkStatus failed (${res.status})`,
        "GATEWAY_STATUS_CHECK_FAILED",
        "payu",
        res.status,
      );
    }

    const data = (await res.json()) as {
      status: number;
      transaction_details: Record<string, { amt: string; status: string; mode: string; error_Message?: string }>;
    };

    const txnDetails = data.transaction_details?.[orderId];
    if (!txnDetails) {
      throw new GatewayError("PayU transaction not found", "GATEWAY_STATUS_NOT_FOUND", "payu", 404);
    }

    const statusMap: Record<string, GatewayPaymentStatus["status"]> = {
      success: "captured",
      failure: "failed",
      pending: "authorized",
      inprogress: "authorized",
    };

    return {
      gatewayOrderId: orderId,
      gateway: "payu",
      status: statusMap[txnDetails.status] ?? "created",
      amountPaise: BigInt(Math.round(parseFloat(txnDetails.amt) * 100)),
      currency: "INR",
      method: txnDetails.mode,
      errorMessage: txnDetails.error_Message,
      updatedAt: new Date().toISOString(),
    };
  },

  async refundPayment(orderId: string, amountPaise?: bigint): Promise<GatewayRefundResult> {
    const merchantKey = getMerchantKey();
    const salt = getSalt();
    const command = "cancel_refund_transaction";
    const hashStr = `${merchantKey}|${command}|${orderId}|${salt}`;
    const hash = computeHash(hashStr);

    const params = new URLSearchParams({
      key: merchantKey,
      command,
      var1: orderId,
      hash,
    });

    if (amountPaise != null) {
      params.set("var2", minorToMajorString(amountPaise));
    }

    const res = await fetchWithTimeout(`${BASE_URL}/merchant/postservice?form=2`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new GatewayError(
        `PayU refund failed (${res.status})`,
        "GATEWAY_REFUND_FAILED",
        "payu",
        res.status,
      );
    }

    const data = (await res.json()) as {
      status: number;
      result: string;
      request_id?: string;
    };

    const processed = data.status === 1;
    return {
      gatewayOrderId: orderId,
      refundId: data.request_id ?? `payu-refund-${orderId}`,
      gateway: "payu",
      refundedAmount: amountPaise ?? BigInt(0),
      currency: "INR",
      status: processed ? "processed" : "failed",
      refundedAt: new Date().toISOString(),
      errorCode: processed ? undefined : "REFUND_FAILED",
      errorMessage: processed ? undefined : data.result,
    };
  },
};

/**
 * Verify the REVERSE hash PayU attaches to a server-to-server callback:
 *   sha512(SALT|status|udf10|...|udf1|email|firstname|productinfo|amount|txnid|key)
 * (prefixed with `additionalCharges|` when PayU sends that field). The key and salt are OUR
 * configured values, never the ones in the body. Returns false for any missing / mismatching hash.
 * Throws GatewayError(GATEWAY_NOT_CONFIGURED) when the merchant key / salt are not set.
 */
export function verifyPayuWebhookHash(body: Record<string, unknown>): boolean {
  const key = getMerchantKey();
  const salt = getSalt();
  const f = (name: string): string => (typeof body[name] === "string" ? (body[name] as string) : "");
  const received = f("hash").toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(received)) return false;
  const parts = [
    salt, f("status"),
    f("udf10"), f("udf9"), f("udf8"), f("udf7"), f("udf6"),
    f("udf5"), f("udf4"), f("udf3"), f("udf2"), f("udf1"),
    f("email"), f("firstname"), f("productinfo"), f("amount"), f("txnid"), key,
  ];
  if (f("additionalCharges")) parts.unshift(f("additionalCharges"));
  const expected = computeHash(parts.join("|"));
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
