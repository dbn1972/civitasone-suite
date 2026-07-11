/**
 * VC-integration module — tenant VC configuration + fallback-chain resolution (Req 13.5).
 *
 * A meeting's VC session is provisioned through a priority-ordered fallback chain of provider
 * adapters (adapter.ts). This module resolves the chain for a tenant from environment config and
 * is the single place BOTH the route (synchronous provider-availability pre-check → 503) and the
 * consumer (actual `createSession` with fallback) obtain the chain — so availability signalling
 * and provisioning always agree on the configured providers and their breaker state.
 *
 * Configuration (env, per steering "all config via environment variables"):
 *   - `VC_PROVIDERS`            — comma list of enabled providers in priority order
 *                                 (default: the full DEFAULT_PROVIDER_PRIORITY, webrtc anchoring).
 *   - `VC_TIMEOUT_MS`           — outbound provider HTTP timeout (default DEFAULT_VC_TIMEOUT_MS).
 *   - `VC_{PROVIDER}_BASE_URL`  — provider REST base URL (e.g. VC_NIC_VC_BASE_URL). Empty ⇒ the
 *   - `VC_{PROVIDER}_API_KEY`     adapter runs in stub mode (realistic shapes, no network).
 *   - `VC_{PROVIDER}_API_SECRET`  optional provider secret.
 *
 * Per-tenant overrides (Req 13.5 "configurable per tenant") are resolved by `resolveVcChain`;
 * today it derives a single env-configured chain, but the tenantId parameter keeps the seam so a
 * tenant-config store can be wired later without touching call sites.
 *
 * Testability: `__setVcChainFactory` swaps the chain factory so route/consumer tests can inject a
 * chain with all providers unavailable (503 path) or a deterministic stub, with no real breakers
 * or network. Reset with `__setVcChainFactory(null)`.
 *
 * _Requirements: 13.1, 13.5, 13.6, 13.7_
 */
import {
  createVCFallbackChain,
  DEFAULT_PROVIDER_PRIORITY,
  DEFAULT_VC_TIMEOUT_MS,
  VC_PROVIDERS,
  type VCAdapterConfig,
  type VCFallbackChain,
  type VCProvider,
} from "./adapter.js";

/** A chain factory: builds the fallback chain for a tenant, optionally pinning a preferred provider. */
export type VcChainFactory = (tenantId: string, preferred?: VCProvider) => VCFallbackChain;

let chainFactoryOverride: VcChainFactory | null = null;

/**
 * TEST-ONLY: override the VC fallback-chain factory (pass `null` to reset). Lets tests inject a
 * chain whose providers are all unavailable (exercising the 503 pre-check) or a deterministic
 * stub chain, without configuring real providers or tripping real breakers.
 */
export function __setVcChainFactory(factory: VcChainFactory | null): void {
  chainFactoryOverride = factory;
}

/** Parse `VC_PROVIDERS` (comma list) into the ordered, validated provider set (else the default). */
function parseEnabledProviders(): VCProvider[] {
  const raw = process.env.VC_PROVIDERS;
  if (!raw) return [...DEFAULT_PROVIDER_PRIORITY];
  const valid = new Set<string>(VC_PROVIDERS);
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is VCProvider => valid.has(s));
  return parsed.length > 0 ? parsed : [...DEFAULT_PROVIDER_PRIORITY];
}

/** Resolve one provider's adapter config from env (empty base URL/key ⇒ stub mode). */
function providerConfig(provider: VCProvider): VCAdapterConfig {
  const key = provider.toUpperCase();
  const apiSecret = process.env[`VC_${key}_API_SECRET`];
  return {
    provider,
    apiBaseUrl: process.env[`VC_${key}_BASE_URL`] ?? "",
    apiKey: process.env[`VC_${key}_API_KEY`] ?? "",
    timeout: Number(process.env.VC_TIMEOUT_MS ?? DEFAULT_VC_TIMEOUT_MS),
    ...(apiSecret !== undefined ? { apiSecret } : {}),
  };
}

/** Build the env-configured fallback chain, moving `preferred` to the front of the priority order. */
function buildEnvChain(preferred?: VCProvider): VCFallbackChain {
  const enabled = parseEnabledProviders();
  const configs = enabled.map(providerConfig);
  const priority =
    preferred && enabled.includes(preferred)
      ? [preferred, ...enabled.filter((p) => p !== preferred)]
      : undefined;
  return createVCFallbackChain(configs, priority);
}

/**
 * Resolve the VC fallback chain for a tenant (Req 13.5). Honours a test override when set,
 * otherwise builds the env-configured chain with `preferred` (if any) leading the priority order.
 */
export function resolveVcChain(tenantId: string, preferred?: VCProvider): VCFallbackChain {
  if (chainFactoryOverride) return chainFactoryOverride(tenantId, preferred);
  return buildEnvChain(preferred);
}

/** True when at least one provider in the tenant's chain is currently available (breaker not open). */
export function anyProviderAvailable(chain: VCFallbackChain): boolean {
  return chain.providers.some((p) => chain.isProviderAvailable(p));
}
