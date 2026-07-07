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

import { createHash } from "node:crypto";
import type {
  PaymentGateway,
  GatewayOrder,
  GatewayPaymentStatus,
  GatewayCaptureResult,
  OrderMetadata,
} from "./types.js";
import { GatewayError } from "./types.js";

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
    const amountStr = (Number(amount) / 100).toFixed(2); // PayU expects rupees
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
};
