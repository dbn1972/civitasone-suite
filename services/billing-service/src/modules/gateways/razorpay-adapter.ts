/**
 * Razorpay payment gateway adapter.
 *
 * Implements the PaymentGateway interface for Razorpay.
 * Uses plain fetch (no SDK dependency) with timeout enforcement.
 *
 * Env vars:
 *   RAZORPAY_KEY_ID     — API key ID
 *   RAZORPAY_KEY_SECRET — API key secret
 */

import type {
  PaymentGateway,
  GatewayOrder,
  GatewayPaymentStatus,
  GatewayCaptureResult,
  GatewayRefundResult,
  OrderMetadata,
} from "./types.js";
import { GatewayError } from "./types.js";

const BASE_URL = process.env.RAZORPAY_BASE_URL ?? "https://api.razorpay.com/v1";
const TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS ?? "10000");

function getKeyId(): string {
  const key = process.env.RAZORPAY_KEY_ID;
  if (!key) throw new GatewayError("RAZORPAY_KEY_ID is not set", "GATEWAY_NOT_CONFIGURED", "razorpay");
  return key;
}

function getKeySecret(): string {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new GatewayError("RAZORPAY_KEY_SECRET is not set", "GATEWAY_NOT_CONFIGURED", "razorpay");
  return secret;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${getKeyId()}:${getKeySecret()}`).toString("base64")}`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GatewayError("Razorpay request timed out", "GATEWAY_TIMEOUT", "razorpay");
    }
    throw new GatewayError("Razorpay network error", "GATEWAY_NETWORK_ERROR", "razorpay");
  } finally {
    clearTimeout(timer);
  }
}

export const razorpayAdapter: PaymentGateway = {
  name: "razorpay",

  async createOrder(amount: bigint, currency: string, metadata: OrderMetadata): Promise<GatewayOrder> {
    const receipt = `order-${metadata.tenantId}-${Date.now()}`;
    const res = await fetchWithTimeout(`${BASE_URL}/orders`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Number(amount),
        currency,
        receipt,
        notes: metadata,
      }),
    });

    if (!res.ok) {
      throw new GatewayError(
        `Razorpay createOrder failed (${res.status})`,
        "GATEWAY_CREATE_ORDER_FAILED",
        "razorpay",
        res.status,
      );
    }

    const data = (await res.json()) as { id: string; status: string; created_at: number };
    return {
      gatewayOrderId: data.id,
      gateway: "razorpay",
      amount,
      currency,
      status: data.status === "paid" ? "paid" : "created",
      metadata,
      createdAt: new Date(data.created_at * 1000).toISOString(),
    };
  },

  async capturePayment(orderId: string): Promise<GatewayCaptureResult> {
    // Razorpay requires fetching the payment first, then capturing
    const paymentsRes = await fetchWithTimeout(`${BASE_URL}/orders/${orderId}/payments`, {
      method: "GET",
      headers: { Authorization: authHeader() },
    });

    if (!paymentsRes.ok) {
      throw new GatewayError(
        `Razorpay fetch payments failed (${paymentsRes.status})`,
        "GATEWAY_CAPTURE_FAILED",
        "razorpay",
        paymentsRes.status,
      );
    }

    const paymentsData = (await paymentsRes.json()) as { items: Array<{ id: string; amount: number; currency: string; status: string }> };
    const payment = paymentsData.items?.[0];
    if (!payment) {
      throw new GatewayError("No payment found for order", "GATEWAY_NO_PAYMENT", "razorpay", 404);
    }

    if (payment.status === "captured") {
      return {
        gatewayOrderId: orderId,
        gateway: "razorpay",
        capturedAmount: BigInt(payment.amount),
        currency: payment.currency,
        status: "captured",
        capturedAt: new Date().toISOString(),
      };
    }

    const captureRes = await fetchWithTimeout(`${BASE_URL}/payments/${payment.id}/capture`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: payment.amount, currency: payment.currency }),
    });

    if (!captureRes.ok) {
      throw new GatewayError(
        `Razorpay capture failed (${captureRes.status})`,
        "GATEWAY_CAPTURE_FAILED",
        "razorpay",
        captureRes.status,
      );
    }

    const captureData = (await captureRes.json()) as { amount: number; currency: string; status: string };
    return {
      gatewayOrderId: orderId,
      gateway: "razorpay",
      capturedAmount: BigInt(captureData.amount),
      currency: captureData.currency,
      status: captureData.status === "captured" ? "captured" : "failed",
      capturedAt: new Date().toISOString(),
    };
  },

  async checkStatus(orderId: string): Promise<GatewayPaymentStatus> {
    const res = await fetchWithTimeout(`${BASE_URL}/orders/${orderId}`, {
      method: "GET",
      headers: { Authorization: authHeader() },
    });

    if (!res.ok) {
      throw new GatewayError(
        `Razorpay checkStatus failed (${res.status})`,
        "GATEWAY_STATUS_CHECK_FAILED",
        "razorpay",
        res.status,
      );
    }

    const data = (await res.json()) as {
      id: string;
      amount: number;
      currency: string;
      status: string;
      method?: string;
    };

    const statusMap: Record<string, GatewayPaymentStatus["status"]> = {
      created: "created",
      attempted: "attempted",
      paid: "captured",
    };

    return {
      gatewayOrderId: data.id,
      gateway: "razorpay",
      status: statusMap[data.status] ?? "created",
      amountPaise: BigInt(data.amount),
      currency: data.currency,
      method: data.method,
      updatedAt: new Date().toISOString(),
    };
  },

  async refundPayment(orderId: string, amountPaise?: bigint): Promise<GatewayRefundResult> {
    const paymentsRes = await fetchWithTimeout(`${BASE_URL}/orders/${orderId}/payments`, {
      method: "GET",
      headers: { Authorization: authHeader() },
    });

    if (!paymentsRes.ok) {
      throw new GatewayError(
        `Razorpay fetch payments for refund failed (${paymentsRes.status})`,
        "GATEWAY_REFUND_FAILED",
        "razorpay",
        paymentsRes.status,
      );
    }

    const paymentsData = (await paymentsRes.json()) as { items: Array<{ id: string; amount: number; currency: string; status: string }> };
    const payment = paymentsData.items?.find((p) => p.status === "captured");
    if (!payment) {
      throw new GatewayError("No captured payment found for refund", "GATEWAY_NO_PAYMENT", "razorpay", 404);
    }

    const refundAmount = amountPaise != null ? Number(amountPaise) : payment.amount;
    const res = await fetchWithTimeout(`${BASE_URL}/payments/${payment.id}/refund`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: refundAmount }),
    });

    if (!res.ok) {
      throw new GatewayError(
        `Razorpay refund failed (${res.status})`,
        "GATEWAY_REFUND_FAILED",
        "razorpay",
        res.status,
      );
    }

    const data = (await res.json()) as { id: string; amount: number; currency: string; status: string };
    return {
      gatewayOrderId: orderId,
      refundId: data.id,
      gateway: "razorpay",
      refundedAmount: BigInt(data.amount),
      currency: data.currency,
      status: data.status === "processed" ? "processed" : "pending",
      refundedAt: new Date().toISOString(),
    };
  },
};
