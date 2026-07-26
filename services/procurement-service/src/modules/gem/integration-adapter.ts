/**
 * SVC-050 GeM / CPPP entity-exchange adapter (tender / order / AOC).
 *
 * Env-gated and fail-closed: when the target provider is not configured, every
 * call throws GemIntegrationError("INTEGRATION_NOT_CONFIGURED"). It never
 * fabricates a success response for an unconfigured provider.
 *
 * Env vars (per provider):
 *   GEM_ENABLED / CPPP_ENABLED          "true" to activate
 *   GEM_BASE_URL / CPPP_BASE_URL        base URL
 *   GEM_API_KEY / CPPP_API_KEY          bearer token
 *   GEM_TIMEOUT_MS                      request timeout (shared, default 15000)
 *
 * All outbound calls run through @civitasone/circuit-breaker. No PII is logged.
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { GemIntegrationError, type Provider, type EntityType } from "./reconcile-domain.js";

const TIMEOUT_MS = Number(process.env.GEM_TIMEOUT_MS ?? "15000");

interface ProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
}

function configFor(provider: Provider): ProviderConfig {
  if (provider === "cppp") {
    return {
      enabled: process.env.CPPP_ENABLED === "true",
      baseUrl: process.env.CPPP_BASE_URL ?? "",
      apiKey: process.env.CPPP_API_KEY ?? "",
    };
  }
  if (provider === "gepnic") {
    return {
      enabled: process.env.GEPNIC_ENABLED === "true",
      baseUrl: process.env.GEPNIC_BASE_URL ?? "",
      apiKey: process.env.GEPNIC_API_KEY ?? "",
    };
  }
  return {
    enabled: process.env.GEM_ENABLED === "true",
    baseUrl: process.env.GEM_BASE_URL ?? "",
    apiKey: process.env.GEM_API_KEY ?? "",
  };
}

/** True only when the provider is enabled AND fully configured. */
export function isIntegrationConfigured(provider: Provider): boolean {
  const c = configFor(provider);
  return c.enabled && c.baseUrl.length > 0 && c.apiKey.length > 0;
}

function assertConfigured(provider: Provider): ProviderConfig {
  const c = configFor(provider);
  if (!c.enabled || !c.baseUrl || !c.apiKey) {
    throw new GemIntegrationError("INTEGRATION_NOT_CONFIGURED", `${provider} integration is not configured`);
  }
  return c;
}

const breakers = new Map<Provider, CircuitBreaker>();
function breakerFor(provider: Provider): CircuitBreaker {
  let b = breakers.get(provider);
  if (!b) {
    b = new CircuitBreaker({ name: `gem-integration-${provider}`, failureThreshold: 5, recoveryMs: 30_000 });
    breakers.set(provider, b);
  }
  return b;
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

export interface ExchangeResult { externalRef: string; externalStatus: string; }

/** Submit a tender / order / AOC entity to the provider. */
export async function exchangeEntity(
  provider: Provider, entityType: EntityType, entityId: string, payload: Record<string, unknown>,
): Promise<ExchangeResult> {
  const c = assertConfigured(provider);
  return breakerFor(provider).call(async () => {
    const res = await fetchWithTimeout(`${c.baseUrl}/api/v1/${entityType}s`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ entityId, ...payload }),
    });
    if (!res.ok) throw new GemIntegrationError("PROVIDER_ERROR", `${provider} returned ${res.status}`);
    const data = await res.json() as { externalRef?: string; status?: string };
    return { externalRef: data.externalRef ?? "", externalStatus: data.status ?? "pending" };
  });
}

/** Fetch the current provider-side status for a previously-exchanged entity. */
export async function getEntityStatus(provider: Provider, externalRef: string): Promise<string> {
  const c = assertConfigured(provider);
  return breakerFor(provider).call(async () => {
    const res = await fetchWithTimeout(`${c.baseUrl}/api/v1/status/${encodeURIComponent(externalRef)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${c.apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new GemIntegrationError("PROVIDER_ERROR", `${provider} returned ${res.status}`);
    const data = await res.json() as { status?: string };
    return data.status ?? "";
  });
}

export { CircuitBreakerOpenError, GemIntegrationError };
