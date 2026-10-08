/**
 * DSC trust-store provider (§23 + §35.5).
 *
 * Server-side DSC verification needs a set of trusted CA / root certificates to
 * decide whether a signer's certificate chains to an authority the court
 * recognises (in India, a CCA-licensed CA under the IT Act). That trust bundle
 * is a deployment / PKI decision, NOT something this repo can hard-code: it
 * differs per installation and must be rotatable without a code change.
 *
 * So we expose a small PROVIDER INTERFACE and ship an env-backed default that
 * FAILS CLOSED: when `COURT_DSC_TRUST_STORE_PEM` is unset (or blank) the
 * provider reports "unconfigured" and verification will report
 * `chainTrusted:false`. It never fabricates trust. A deployment that wants the
 * full chain-of-trust guarantee supplies the PEM bundle; everything that CAN be
 * verified locally without it (PKCS#7 structure, signer certificate validity
 * window, key usage, and — at issue time — the cryptographic signature over the
 * order content) is still verified regardless.
 *
 * HUMAN REVIEW: configure `COURT_DSC_TRUST_STORE_PEM` (concatenated PEM of the
 * trusted CCA/CA roots) in each environment to enable chain-of-trust
 * enforcement. Until then, chain trust is reported as not-configured.
 */

export interface DscTrustStoreProvider {
  /**
   * The concatenated PEM of trusted CA/root certificates, or null when no trust
   * store is configured (fail-closed — the caller must treat null as untrusted,
   * never as "trust everything").
   */
  getTrustStorePem(): string | null;
  /** True when a non-empty trust store is configured. */
  isConfigured(): boolean;
}

/** Env-backed, fail-closed default. */
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
