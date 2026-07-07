/**
 * Multi-gateway payment adapter — factory/selector.
 *
 * Selects the active payment gateway based on `PAYMENT_GATEWAY` environment variable.
 * Wraps all gateway operations with circuit-breaker and retry logic.
 *
 * Supported gateways: razorpay, payu, ccavenue
 *
 * Requirements: 13.4, 13.5, 13.6, 13.7, 13.8
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import type {
  PaymentGateway,
  GatewayName,
  GatewayOrder,
  GatewayPaymentStatus,
  GatewayCaptureResult,
  OrderMetadata,
} from "./types.js";
import { GatewayError } from "./types.js";
import { withRetry } from "./retry.js";
import { razorpayAdapter } from "./razorpay-adapter.js";
import { payuAdapter } from "./payu-adapter.js";
import { ccavenueAdapter } from "./ccavenue-adapter.js";

// ── Gateway Registry ──────────────────────────────────────────────

const ADAPTERS: Record<GatewayName, PaymentGateway> = {
  razorpay: razorpayAdapter,
  payu: payuAdapter,
  ccavenue: ccavenueAdapter,
};

// ── Circuit Breaker (shared across the active gateway) ────────────

const breaker = new CircuitBreaker({
  name: "payment-gateway",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Factory ───────────────────────────────────────────────────────

/**
 * Get the configured gateway name from env.
 * Defaults to "razorpay" if not set.
 */
export function getConfiguredGateway(): GatewayName {
  const gw = (process.env.PAYMENT_GATEWAY ?? "razorpay").toLowerCase();
  if (gw === "razorpay" || gw === "payu" || gw === "ccavenue") {
    return gw;
  }
  return "razorpay"; // safe default
}

/**
 * Resolve the active PaymentGateway adapter instance.
 */
export function resolveGateway(name?: GatewayName): PaymentGateway {
  const gatewayName = name ?? getConfiguredGateway();
  const adapter = ADAPTERS[gatewayName];
  if (!adapter) {
    throw new GatewayError(
      `Unknown payment gateway: ${gatewayName}`,
      "GATEWAY_NOT_CONFIGURED",
      "razorpay",
    );
  }
  return adapter;
}

// ── Wrapped Operations (circuit-breaker + retry) ──────────────────

/**
 * Create a payment order via the configured gateway.
 * Wrapped with circuit-breaker and exponential backoff retry.
 *
 * - Retries on 5xx / timeout (max 3 attempts: 1s, 2s, 4s)
 * - No retry on 4xx
 */
export async function createOrder(
  amount: bigint,
  currency: string,
  metadata: OrderMetadata,
): Promise<GatewayOrder> {
  const gateway = resolveGateway();

  return withRetry(() =>
    breaker.call(() => gateway.createOrder(amount, currency, metadata)),
  );
}

/**
 * Capture a payment via the configured gateway.
 * Wrapped with circuit-breaker and exponential backoff retry.
 */
export async function capturePayment(orderId: string): Promise<GatewayCaptureResult> {
  const gateway = resolveGateway();

  return withRetry(() =>
    breaker.call(() => gateway.capturePayment(orderId)),
  );
}

/**
 * Check payment status via the configured gateway.
 * Wrapped with circuit-breaker and exponential backoff retry.
 */
export async function checkStatus(orderId: string): Promise<GatewayPaymentStatus> {
  const gateway = resolveGateway();

  return withRetry(() =>
    breaker.call(() => gateway.checkStatus(orderId)),
  );
}

// ── Exports ───────────────────────────────────────────────────────

export { GatewayError, CircuitBreakerOpenError };
export type {
  PaymentGateway,
  GatewayName,
  GatewayOrder,
  GatewayPaymentStatus,
  GatewayCaptureResult,
  OrderMetadata,
};
export { isUpiEnabled, isEmandateEnabled } from "./upi-autopay.js";
export { withRetry } from "./retry.js";
