/**
 * CCAvenue payment gateway adapter.
 *
 * Implements the PaymentGateway interface for CCAvenue.
 * Uses plain fetch with timeout enforcement.
 *
 * Env vars:
 *   CCAVENUE_MERCHANT_ID  — Merchant ID
 *   CCAVENUE_ACCESS_CODE  — Access code
 *   CCAVENUE_WORKING_KEY  — Working key for encryption
 *   CCAVENUE_BASE_URL     — API base URL
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type {
  PaymentGateway,
  GatewayOrder,
  GatewayPaymentStatus,
  GatewayCaptureResult,
  GatewayRefundResult,
  OrderMetadata,
} from "./types.js";
import { GatewayError } from "./types.js";

const BASE_URL = process.env.CCAVENUE_BASE_URL ?? "https://test.ccavenue.com";
const TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS ?? "10000");

function getMerchantId(): string {
  const id = process.env.CCAVENUE_MERCHANT_ID;
  if (!id) throw new GatewayError("CCAVENUE_MERCHANT_ID is not set", "GATEWAY_NOT_CONFIGURED", "ccavenue");
  return id;
}

function getAccessCode(): string {
  const code = process.env.CCAVENUE_ACCESS_CODE;
  if (!code) throw new GatewayError("CCAVENUE_ACCESS_CODE is not set", "GATEWAY_NOT_CONFIGURED", "ccavenue");
  return code;
}

function getWorkingKey(): string {
  const key = process.env.CCAVENUE_WORKING_KEY;
  if (!key) throw new GatewayError("CCAVENUE_WORKING_KEY is not set", "GATEWAY_NOT_CONFIGURED", "ccavenue");
  return key;
}

function encrypt(plainText: string, workingKey: string): string {
  const keyHash = createHash("md5").update(workingKey).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-cbc", keyHash, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + encrypted;
}

function decrypt(encText: string, workingKey: string): string {
  const keyHash = createHash("md5").update(workingKey).digest();
  const iv = Buffer.from(encText.slice(0, 32), "hex");
  const encrypted = encText.slice(32);
  const decipher = createDecipheriv("aes-128-cbc", keyHash, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GatewayError("CCAvenue request timed out", "GATEWAY_TIMEOUT", "ccavenue");
    }
    throw new GatewayError("CCAvenue network error", "GATEWAY_NETWORK_ERROR", "ccavenue");
  } finally {
    clearTimeout(timer);
  }
}

export const ccavenueAdapter: PaymentGateway = {
  name: "ccavenue",

  async createOrder(amount: bigint, currency: string, metadata: OrderMetadata): Promise<GatewayOrder> {
    const orderId = `cca-${metadata.tenantId}-${Date.now()}`;
    const amountStr = (Number(amount) / 100).toFixed(2); // CCAvenue expects rupees
    const merchantId = getMerchantId();
    const accessCode = getAccessCode();
    const workingKey = getWorkingKey();

    const orderData = [
      `merchant_id=${merchantId}`,
      `order_id=${orderId}`,
      `currency=${currency}`,
      `amount=${amountStr}`,
      `redirect_url=${process.env.CCAVENUE_REDIRECT_URL ?? "https://localhost/ccavenue/redirect"}`,
      `cancel_url=${process.env.CCAVENUE_CANCEL_URL ?? "https://localhost/ccavenue/cancel"}`,
      `language=EN`,
    ].join("&");

    const encryptedData = encrypt(orderData, workingKey);

    const params = new URLSearchParams({
      encRequest: encryptedData,
      access_code: accessCode,
    });

    const res = await fetchWithTimeout(`${BASE_URL}/transaction/transaction.do?command=initiateTransaction`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new GatewayError(
        `CCAvenue createOrder failed (${res.status})`,
        "GATEWAY_CREATE_ORDER_FAILED",
        "ccavenue",
        res.status,
      );
    }

    return {
      gatewayOrderId: orderId,
      gateway: "ccavenue",
      amount,
      currency,
      status: "created",
      metadata,
      createdAt: new Date().toISOString(),
    };
  },

  async capturePayment(orderId: string): Promise<GatewayCaptureResult> {
    // CCAvenue auto-captures; use order status API to confirm
    const status = await this.checkStatus(orderId);

    return {
      gatewayOrderId: orderId,
      gateway: "ccavenue",
      capturedAmount: status.amountPaise,
      currency: status.currency,
      status: status.status === "captured" ? "captured" : "failed",
      capturedAt: new Date().toISOString(),
      errorCode: status.errorCode,
      errorMessage: status.errorMessage,
    };
  },

  async checkStatus(orderId: string): Promise<GatewayPaymentStatus> {
    const merchantId = getMerchantId();
    const accessCode = getAccessCode();
    const workingKey = getWorkingKey();

    const queryData = `merchant_id=${merchantId}&order_no=${orderId}`;
    const encryptedData = encrypt(queryData, workingKey);

    const params = new URLSearchParams({
      encRequest: encryptedData,
      access_code: accessCode,
    });

    const res = await fetchWithTimeout(`${BASE_URL}/apis/servlet/DoWebTrans?command=orderStatusTracker`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new GatewayError(
        `CCAvenue checkStatus failed (${res.status})`,
        "GATEWAY_STATUS_CHECK_FAILED",
        "ccavenue",
        res.status,
      );
    }

    const responseText = await res.text();
    // CCAvenue returns encrypted response
    let decryptedData: string;
    try {
      decryptedData = decrypt(responseText.trim(), workingKey);
    } catch {
      throw new GatewayError("CCAvenue response decryption failed", "GATEWAY_DECRYPT_ERROR", "ccavenue");
    }

    // Parse key=value pairs from decrypted response
    const params2 = new URLSearchParams(decryptedData);
    const orderStatus = params2.get("order_status") ?? "";
    const amountStr = params2.get("amount") ?? "0";
    const currencyVal = params2.get("currency") ?? "INR";
    const paymentMode = params2.get("payment_mode") ?? undefined;
    const statusMessage = params2.get("status_message") ?? undefined;

    const statusMap: Record<string, GatewayPaymentStatus["status"]> = {
      Success: "captured",
      Failure: "failed",
      Aborted: "failed",
      Initiated: "created",
      Timeout: "failed",
    };

    return {
      gatewayOrderId: orderId,
      gateway: "ccavenue",
      status: statusMap[orderStatus] ?? "created",
      amountPaise: BigInt(Math.round(parseFloat(amountStr) * 100)),
      currency: currencyVal,
      method: paymentMode,
      errorMessage: orderStatus === "Failure" ? statusMessage : undefined,
      updatedAt: new Date().toISOString(),
    };
  },

  async refundPayment(orderId: string, amountPaise?: bigint): Promise<GatewayRefundResult> {
    const merchantId = getMerchantId();
    const accessCode = getAccessCode();
    const workingKey = getWorkingKey();

    const refundData = [
      `merchant_id=${merchantId}`,
      `reference_no=${orderId}`,
      `refund_amount=${amountPaise != null ? (Number(amountPaise) / 100).toFixed(2) : ""}`,
      `refund_ref_no=refund-${orderId}-${Date.now()}`,
    ].join("&");

    const encryptedData = encrypt(refundData, workingKey);
    const params = new URLSearchParams({
      encRequest: encryptedData,
      access_code: accessCode,
    });

    const res = await fetchWithTimeout(`${BASE_URL}/apis/servlet/DoWebTrans?command=refundOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new GatewayError(
        `CCAvenue refund failed (${res.status})`,
        "GATEWAY_REFUND_FAILED",
        "ccavenue",
        res.status,
      );
    }

    const responseText = await res.text();
    let decryptedData: string;
    try {
      decryptedData = decrypt(responseText.trim(), workingKey);
    } catch {
      throw new GatewayError("CCAvenue refund response decryption failed", "GATEWAY_DECRYPT_ERROR", "ccavenue");
    }

    const params2 = new URLSearchParams(decryptedData);
    const refundStatus = params2.get("refund_status") ?? "";
    const refundRefNo = params2.get("refund_ref_no") ?? `cca-refund-${orderId}`;

    return {
      gatewayOrderId: orderId,
      refundId: refundRefNo,
      gateway: "ccavenue",
      refundedAmount: amountPaise ?? BigInt(0),
      currency: "INR",
      status: refundStatus === "0" ? "processed" : "failed",
      refundedAt: new Date().toISOString(),
      errorMessage: refundStatus !== "0" ? params2.get("reason") ?? undefined : undefined,
    };
  },
};
