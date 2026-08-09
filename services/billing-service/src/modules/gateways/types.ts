/**
 * Multi-gateway payment adapter — shared types.
 *
 * Each gateway adapter implements the PaymentGateway interface.
 * The active gateway is selected at runtime via the PAYMENT_GATEWAY env var.
 */

export type GatewayName = "razorpay" | "payu" | "ccavenue";

export interface OrderMetadata {
  tenantId: string;
  subscriptionId?: string | undefined;
  invoiceId?: string | undefined;
  [key: string]: string | undefined;
}

export interface GatewayOrder {
  gatewayOrderId: string;
  gateway: GatewayName;
  amount: bigint;
  currency: string;
  status: "created" | "attempted" | "paid" | "failed";
  metadata: OrderMetadata;
  createdAt: string;
}

export interface GatewayPaymentStatus {
  gatewayOrderId: string;
  gateway: GatewayName;
  status: "created" | "attempted" | "authorized" | "captured" | "failed" | "refunded";
  amountPaise: bigint;
  currency: string;
  method?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  updatedAt: string;
}

export interface GatewayCaptureResult {
  gatewayOrderId: string;
  gateway: GatewayName;
  capturedAmount: bigint;
  currency: string;
  status: "captured" | "failed";
  capturedAt: string;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface GatewayRefundResult {
  gatewayOrderId: string;
  refundId: string;
  gateway: GatewayName;
  refundedAmount: bigint;
  currency: string;
  status: "processed" | "pending" | "failed";
  refundedAt: string;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface PaymentGateway {
  readonly name: GatewayName;

  createOrder(amount: bigint, currency: string, metadata: OrderMetadata): Promise<GatewayOrder>;

  capturePayment(orderId: string): Promise<GatewayCaptureResult>;

  checkStatus(orderId: string): Promise<GatewayPaymentStatus>;

  refundPayment(orderId: string, amountPaise?: bigint): Promise<GatewayRefundResult>;
}

/**
 * Error class for gateway-specific errors.
 * Includes HTTP status from the gateway for retry/no-retry classification.
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly gateway: GatewayName | "upi-autopay" | "e-mandate",
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }

  /** Returns true if this error is transient (5xx or timeout) and retryable. */
  get isTransient(): boolean {
    if (!this.httpStatus) return true; // timeout/network error → transient
    return this.httpStatus >= 500;
  }

  /** Returns true if this is a client error (4xx) that should NOT be retried. */
  get isClientError(): boolean {
    if (!this.httpStatus) return false;
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }
}
