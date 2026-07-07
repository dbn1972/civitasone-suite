/**
 * GeM adapter — Government Rail integration for Government e-Marketplace
 * product search, product details, and order submission.
 *
 * Env-gated: fails closed when GEM_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   GEM_ENABLED   — "true" to activate; anything else → fail-closed
 *   GEM_BASE_URL  — Base URL for the GeM API
 *   GEM_API_KEY   — API key for authentication
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface GemProductSearchQuery {
  q: string;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface GemProduct {
  productId: string;
  name: string;
  category: string;
  brand?: string | undefined;
  unitPriceMinor: string;
  currency: string;
  seller?: string | undefined;
  availability: "in_stock" | "out_of_stock" | "limited";
}

export interface GemProductSearchResult {
  products: GemProduct[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GemProductDetails {
  productId: string;
  name: string;
  category: string;
  brand?: string | undefined;
  description?: string | undefined;
  specifications?: Record<string, string> | undefined;
  unitPriceMinor: string;
  currency: string;
  seller?: string | undefined;
  availability: "in_stock" | "out_of_stock" | "limited";
  lastUpdatedAt: string;
}

export interface GemOrderPayload {
  items: Array<{
    productId: string;
    quantity: number;
    deliveryAddress: string;
  }>;
  buyerOrganization: string;
  contactName: string;
  contactEmail: string;
  remarks?: string | undefined;
}

export interface GemOrderResult {
  orderId: string;
  status: "accepted" | "pending_review";
  submittedAt: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class GemAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GemAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.GEM_ENABLED === "true";
const BASE_URL = process.env.GEM_BASE_URL ?? "";
const API_KEY = process.env.GEM_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.GEM_TIMEOUT_MS ?? "15000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "gem",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new GemAdapterError(
      "GeM integration is not available",
      "INTEGRATION_DISABLED",
    );
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Search GeM product catalog.
 *
 * Throws GemAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function searchProducts(query: GemProductSearchQuery): Promise<GemProductSearchResult> {
  assertEnabled();

  return breaker.call(async () => {
    const params = new URLSearchParams();
    params.set("q", query.q);
    if (query.page != null) params.set("page", String(query.page));
    if (query.pageSize != null) params.set("pageSize", String(query.pageSize));

    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/products?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new GemAdapterError(
        `GeM API returned ${res.status}`,
        "GEM_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      products?: GemProduct[];
      total?: number;
      page?: number;
      pageSize?: number;
    };

    return {
      products: data.products ?? [],
      total: data.total ?? 0,
      page: data.page ?? query.page ?? 1,
      pageSize: data.pageSize ?? query.pageSize ?? 20,
    };
  });
}

/**
 * Get product details from GeM catalog.
 *
 * Throws GemAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function getProductDetails(productId: string): Promise<GemProductDetails> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/products/${encodeURIComponent(productId)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new GemAdapterError(
        `GeM API returned ${res.status}`,
        "GEM_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      productId?: string;
      name?: string;
      category?: string;
      brand?: string;
      description?: string;
      specifications?: Record<string, string>;
      unitPriceMinor?: string;
      currency?: string;
      seller?: string;
      availability?: string;
      lastUpdatedAt?: string;
    };

    const validAvailabilities = ["in_stock", "out_of_stock", "limited"] as const;
    const availability = validAvailabilities.includes(data.availability as typeof validAvailabilities[number])
      ? (data.availability as GemProductDetails["availability"])
      : "out_of_stock";

    return {
      productId: data.productId ?? productId,
      name: data.name ?? "",
      category: data.category ?? "",
      brand: data.brand,
      description: data.description,
      specifications: data.specifications,
      unitPriceMinor: data.unitPriceMinor ?? "0",
      currency: data.currency ?? "INR",
      seller: data.seller,
      availability,
      lastUpdatedAt: data.lastUpdatedAt ?? new Date().toISOString(),
    };
  });
}

/**
 * Submit an order to GeM.
 *
 * Throws GemAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function submitOrder(order: GemOrderPayload): Promise<GemOrderResult> {
  assertEnabled();

  return breaker.call(async () => {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/v1/orders`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          items: order.items,
          buyerOrganization: order.buyerOrganization,
          contactName: order.contactName,
          contactEmail: order.contactEmail,
          remarks: order.remarks,
        }),
      },
    );

    if (!res.ok) {
      throw new GemAdapterError(
        `GeM API returned ${res.status}`,
        "GEM_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      orderId?: string;
      status?: string;
      submittedAt?: string;
    };

    return {
      orderId: data.orderId ?? "",
      status: data.status === "accepted" ? "accepted" : "pending_review",
      submittedAt: data.submittedAt ?? new Date().toISOString(),
    };
  });
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the adapter is enabled and configured. */
export function isEnabled(): boolean {
  return ENABLED && BASE_URL.length > 0 && API_KEY.length > 0;
}

export { CircuitBreakerOpenError };
