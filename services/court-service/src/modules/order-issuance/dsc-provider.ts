/**
 * DSC trust-store provider + chain-trust policy (§23 + §35.5).
 *
 * Server-side DSC verification needs a set of trusted CA / root certificates to
 * decide whether a signer's certificate chains to an authority the court
 * recognises (in India, a CCA-licensed CA under the IT Act). That trust bundle
 * is a deployment / PKI decision, NOT something this repo can hard-code: it
 * differs per installation and must be rotatable without a code change.
 *
 * So we expose a small PROVIDER INTERFACE and ship an env-backed default. When
 * `COURT_DSC_TRUST_STORE_PEM` is unset (or blank) the provider reports
 * "unconfigured" and verification reports `chainTrusted:false` — it never
 * fabricates trust. Everything that CAN be verified locally without it (PKCS#7
 * structure, signer certificate validity window, key usage, and — at issue
 * time — the cryptographic signature over the order content) is still verified
 * regardless.
 *
 * Whether chain trust is REQUIRED to issue an order is decided by
 * `resolveDscChainTrustPolicy()` below (UAT F65 — owner-approved policy):
 *   • production (any NODE_ENV other than an explicit "development" / "test",
 *     the same allow-list as `@civitasone/auth`'s isDevOrTestEnv / SEC-017):
 *     chain trust is ALWAYS required. With no trust store configured every
 *     DSC — including a self-signed one — is refused, and the API + worker
 *     refuse to start (`assertDscChainTrustConfigured`). FAIL CLOSED.
 *   • development / test: chain trust is required only when a trust store is
 *     configured. Without one a cryptographically valid but untrusted
 *     (e.g. self-signed) DSC is ACCEPTED, with a WARN at startup and on every
 *     verification. FAIL OPEN, loudly — this is the UAT posture.
 *   • `COURT_DSC_REQUIRE_CHAIN_TRUST=true` (or `1`) forces chain trust on in
 *     any environment. It can only strengthen the policy; it cannot switch
 *     enforcement off in production.
 *
 * HUMAN REVIEW: configure `COURT_DSC_TRUST_STORE_PEM` (concatenated PEM of the
 * trusted CCA/CA roots) in each production environment — the court service
 * will not start in production without it.
 */
import { isDevOrTestEnv } from "@civitasone/auth";
import { pino } from "pino";

export interface DscTrustStoreProvider {
  /**
   * The concatenated PEM of trusted CA/root certificates, or null when no trust
   * store is configured. The caller must treat null as untrusted, never as
   * "trust everything".
   */
  getTrustStorePem(): string | null;
  /** True when a non-empty trust store is configured. */
  isConfigured(): boolean;
}

/** Env-backed default provider (never fabricates trust). */
export class EnvDscTrustStoreProvider implements DscTrustStoreProvider {
  constructor(private readonly envVar: string = "COURT_DSC_TRUST_STORE_PEM") {}

  getTrustStorePem(): string | null {
    const raw = (process.env[this.envVar] ?? "").trim();
    return raw.length > 0 ? raw : null;
  }

  isConfigured(): boolean {
    return this.getTrustStorePem() !== null;
  }
}

/** The process-wide default provider. */
export const defaultDscTrustStoreProvider: DscTrustStoreProvider = new EnvDscTrustStoreProvider();

/** Minimal logger surface (pino / Fastify's app.log both satisfy it). */
export interface DscPolicyLogger {
  warn(obj: object, msg: string): void;
}

/**
 * Logger for DSC policy warnings. The API (buildApp → app.log) and the worker
 * (startWorker → its service logger) inject theirs via
 * `assertDscChainTrustConfigured(provider, logger)` at startup, so the
 * service's log config and redaction apply. The standalone pino fallback is only
 * used by code paths that never ran the startup check (scripts, unit tests).
 */
let policyLogger: DscPolicyLogger | null = null;

export function dscPolicyLog(): DscPolicyLogger {
  policyLogger ??= pino({ name: "court-dsc" });
  return policyLogger;
}

export type DscChainTrustReason =
  /** COURT_DSC_REQUIRE_CHAIN_TRUST=true|1 */
  | "forced_by_env"
  /** NODE_ENV is not an explicit development/test value. */
  | "production"
  /** development/test with a trust store configured. */
  | "trust_store_configured"
  /** development/test without a trust store — chain trust NOT enforced. */
  | "not_enforced_non_production";

export interface DscChainTrustPolicy {
  /** Whether a signer must chain to the trust store for an order to be issued. */
  required: boolean;
  /** Whether a non-empty trust store is configured. */
  trustStoreConfigured: boolean;
  reason: DscChainTrustReason;
}

function forcedByEnv(): boolean {
  const v = (process.env.COURT_DSC_REQUIRE_CHAIN_TRUST ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Resolve the chain-trust policy for this process (see module doc). */
export function resolveDscChainTrustPolicy(
  provider: DscTrustStoreProvider = defaultDscTrustStoreProvider,
): DscChainTrustPolicy {
  const trustStoreConfigured = provider.isConfigured();
  if (forcedByEnv()) return { required: true, trustStoreConfigured, reason: "forced_by_env" };
  if (!isDevOrTestEnv()) return { required: true, trustStoreConfigured, reason: "production" };
  if (trustStoreConfigured) return { required: true, trustStoreConfigured, reason: "trust_store_configured" };
  return { required: false, trustStoreConfigured, reason: "not_enforced_non_production" };
}

let startupWarned = false;

/**
 * Startup check, called by both the API (buildApp) and the worker
 * (startWorker) — both paths verify DSCs.
 *
 * Throws when chain trust is required but no trust store is configured (always
 * the case in production without `COURT_DSC_TRUST_STORE_PEM`): such a process
 * could not issue any DSC-signed order, and must not run fail-open. Outside
 * production with no trust store it logs a single WARN per process.
 */
export function assertDscChainTrustConfigured(
  provider: DscTrustStoreProvider = defaultDscTrustStoreProvider,
  logger?: DscPolicyLogger,
): DscChainTrustPolicy {
  if (logger) policyLogger = logger;
  logger ??= dscPolicyLog();
  const policy = resolveDscChainTrustPolicy(provider);
  if (policy.required && !policy.trustStoreConfigured) {
    throw new Error(
      `COURT_DSC_TRUST_STORE_PEM is required (chain-of-trust enforcement: ${policy.reason}, ` +
        `NODE_ENV=${JSON.stringify(process.env.NODE_ENV ?? null)}). Configure the concatenated PEM ` +
        `of the trusted CCA/CA roots. Refusing to start — without it every DSC-signed court order ` +
        `would be refused.`,
    );
  }
  if (!policy.required && !startupWarned) {
    startupWarned = true;
    logger.warn(
      { trustStoreConfigured: false, nodeEnv: process.env.NODE_ENV ?? null },
      "DSC chain-of-trust is NOT enforced: COURT_DSC_TRUST_STORE_PEM is unset (non-production). " +
        "Self-signed / untrusted DSCs will be accepted for court order issuance. " +
        "This is refused in production.",
    );
  }
  return policy;
}
