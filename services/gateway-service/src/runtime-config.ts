/**
 * Runtime-configurable gateway parameters.
 *
 * These values initialize from environment variables but can be updated at
 * runtime via the internal config endpoint (called by admin-service). Changes
 * take effect immediately without a gateway restart.
 *
 * Admin UI → admin-service PATCH /v1/admin/platform-config/gateway
 *   → admin-service calls gateway internal endpoint POST /internal/config
 *   → gateway applies new values in-memory
 *
 * Persistence: admin-service stores the config; gateway reads env on boot,
 * then admin-service pushes the latest config on startup via health-check loop.
 */
import { pino } from "pino";

const log = pino({ name: "gateway-config" });

export interface GatewayRuntimeConfig {
  /** JWT edge verification mode: "true" | "audit" | "off" */
  jwtEdgeVerify: "true" | "audit" | "off";
  /** Per-upstream request timeout in milliseconds */
  upstreamTimeoutMs: number;
  /** Consecutive 5xx failures before circuit breaker trips open */
  cbFailureThreshold: number;
  /** Milliseconds the circuit breaker stays open before probing */
  cbRecoveryMs: number;
  /** Global rate limit (requests per minute) */
  rateLimitMax: number;
  /** Per-tenant rate limit (requests per minute) */
  rateLimitTenantMax: number;
  /** Auth rate limit for /api/identity/* (requests per minute) */
  authRateLimitMax: number;
  /** Request body size limit in bytes */
  bodyLimitBytes: number;
}

/** Current runtime config — mutable. */
const config: GatewayRuntimeConfig = {
  jwtEdgeVerify: (process.env.GATEWAY_JWT_EDGE_VERIFY ?? "true") as GatewayRuntimeConfig["jwtEdgeVerify"],
  upstreamTimeoutMs: Number(process.env.GATEWAY_UPSTREAM_TIMEOUT_MS ?? 15_000),
  cbFailureThreshold: Number(process.env.GATEWAY_CB_FAILURE_THRESHOLD ?? 5),
  cbRecoveryMs: Number(process.env.GATEWAY_CB_RECOVERY_MS ?? 15_000),
  rateLimitMax: Number(process.env.GATEWAY_RATE_LIMIT_MAX ?? 1000),
  rateLimitTenantMax: Number(process.env.GATEWAY_RATE_LIMIT_TENANT_MAX ?? 200),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
  bodyLimitBytes: Number(process.env.GATEWAY_BODY_LIMIT_BYTES ?? 1_048_576),
};

/** Read the current runtime config (immutable copy). */
export function getConfig(): Readonly<GatewayRuntimeConfig> {
  return { ...config };
}

/** Get a single config value (used by modules that need current settings). */
export function configValue<K extends keyof GatewayRuntimeConfig>(key: K): GatewayRuntimeConfig[K] {
  return config[key];
}

/**
 * Apply a partial config update. Only provided keys are changed; others retain
 * their current value. Validates ranges before applying.
 *
 * Returns the full config after applying changes.
 */
export function applyConfig(patch: Partial<GatewayRuntimeConfig>): GatewayRuntimeConfig {
  if (patch.jwtEdgeVerify !== undefined) {
    if (!["true", "audit", "off"].includes(patch.jwtEdgeVerify)) {
      throw new ConfigError("jwtEdgeVerify must be 'true', 'audit', or 'off'");
    }
    config.jwtEdgeVerify = patch.jwtEdgeVerify;
  }

  if (patch.upstreamTimeoutMs !== undefined) {
    if (patch.upstreamTimeoutMs < 1000 || patch.upstreamTimeoutMs > 120_000) {
      throw new ConfigError("upstreamTimeoutMs must be between 1000 and 120000");
    }
    config.upstreamTimeoutMs = patch.upstreamTimeoutMs;
  }

  if (patch.cbFailureThreshold !== undefined) {
    if (patch.cbFailureThreshold < 1 || patch.cbFailureThreshold > 50) {
      throw new ConfigError("cbFailureThreshold must be between 1 and 50");
    }
    config.cbFailureThreshold = patch.cbFailureThreshold;
  }

  if (patch.cbRecoveryMs !== undefined) {
    if (patch.cbRecoveryMs < 1000 || patch.cbRecoveryMs > 300_000) {
      throw new ConfigError("cbRecoveryMs must be between 1000 and 300000");
    }
    config.cbRecoveryMs = patch.cbRecoveryMs;
  }

  if (patch.rateLimitMax !== undefined) {
    if (patch.rateLimitMax < 10 || patch.rateLimitMax > 100_000) {
      throw new ConfigError("rateLimitMax must be between 10 and 100000");
    }
    config.rateLimitMax = patch.rateLimitMax;
  }

  if (patch.rateLimitTenantMax !== undefined) {
    if (patch.rateLimitTenantMax < 10 || patch.rateLimitTenantMax > 10_000) {
      throw new ConfigError("rateLimitTenantMax must be between 10 and 10000");
    }
    config.rateLimitTenantMax = patch.rateLimitTenantMax;
  }

  if (patch.authRateLimitMax !== undefined) {
    if (patch.authRateLimitMax < 3 || patch.authRateLimitMax > 1000) {
      throw new ConfigError("authRateLimitMax must be between 3 and 1000");
    }
    config.authRateLimitMax = patch.authRateLimitMax;
  }

  if (patch.bodyLimitBytes !== undefined) {
    if (patch.bodyLimitBytes < 1024 || patch.bodyLimitBytes > 52_428_800) {
      throw new ConfigError("bodyLimitBytes must be between 1024 and 52428800 (50MB)");
    }
    config.bodyLimitBytes = patch.bodyLimitBytes;
  }

  log.info({ config }, "gateway runtime config updated");
  return { ...config };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
