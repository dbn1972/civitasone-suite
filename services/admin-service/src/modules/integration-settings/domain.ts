/**
 * integration-settings — pure domain logic.
 *
 * No I/O: input validation, secret splitting/sealing (reusing central-config's
 * AES-256-GCM crypto + CONFIG_ENC_KEY), masking for display, and the
 * maker-checker + optimistic-version guards. Deterministic + unit-testable.
 */
import {
  ConfigError,
  encryptValue,
  decryptValue,
  configKey,
  isEncryptedBlob,
} from "../central-config/domain.js";
import { REGISTRY, type Provider } from "./providers.js";

export { ConfigError };

/** Maker-checker: the approver must differ from the proposer. */
export function assertApproverDistinct(proposerId: string, approverId: string): void {
  if (proposerId === approverId) {
    throw new ConfigError(
      409,
      "MAKER_CHECKER_VIOLATION",
      "the approver must differ from the proposer of an integration change",
    );
  }
}

/** Only a still-pending change may be approved or rejected. */
export function assertPending(status: string): void {
  if (status !== "pending") {
    throw new ConfigError(
      409,
      "NOT_PENDING",
      `change request is '${status}', only 'pending' requests can be decided`,
    );
  }
}

/**
 * Optimistic concurrency: a proposal carries the live version it was based on.
 * If the live row has moved on, reject 409 so the caller re-reads and retries.
 */
export function assertVersionMatch(expected: number | null | undefined, actual: number): void {
  if (expected != null && expected !== actual) {
    throw new ConfigError(
      409,
      "VERSION_CONFLICT",
      `stale version: expected ${expected} but current is ${actual}; re-read and retry`,
    );
  }
}

export type SplitInput = {
  /** non-secret settings to store in `config` */
  config: Record<string, unknown>;
  /** secret field → plaintext value */
  secrets: Record<string, string>;
};

/**
 * Validate + split a raw provider input into its non-secret `config` and its
 * secret bundle, per the provider's registry definition. Throws ConfigError on
 * a schema violation (surfaced as 400).
 */
export function validateAndSplit(provider: Provider, raw: unknown): SplitInput {
  const def = REGISTRY[provider];
  const parsed = def.inputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ConfigError(400, "INVALID_PROVIDER_CONFIG", `invalid ${provider} config: ${msg}`);
  }
  const value = parsed.data as Record<string, unknown>;
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (def.secretFields.includes(k)) {
      if (v != null && v !== "") secrets[k] = String(v);
    } else {
      config[k] = v;
    }
  }
  return { config, secrets };
}

/** Compute the masked last4 of the primary secret (for display), or null. */
export function primaryLast4(provider: Provider, secrets: Record<string, string>): string | null {
  const def = REGISTRY[provider];
  const primary = secrets[def.primarySecret];
  const anySecret = primary ?? Object.values(secrets)[0];
  if (!anySecret) return null;
  return anySecret.slice(-4);
}

/**
 * Seal a secret bundle to ciphertext. Fail-closed: a non-empty secret bundle
 * with NO configured CONFIG_ENC_KEY is rejected — we never store a secret in
 * plaintext. An empty bundle returns null ciphertext (no secret to store).
 */
export function sealSecrets(secrets: Record<string, string>): { ciphertext: string | null; last4Source: string | null } {
  if (Object.keys(secrets).length === 0) return { ciphertext: null, last4Source: null };
  const key = configKey();
  if (!key) {
    throw new ConfigError(
      503,
      "ENCRYPTION_UNAVAILABLE",
      "integration secrets cannot be stored: CONFIG_ENC_KEY is not configured",
    );
  }
  return { ciphertext: encryptValue(secrets, key), last4Source: null };
}

/** Decrypt a stored secret bundle server-side (for test-connection / adapters). */
export function openSecrets(ciphertext: string | null | undefined): Record<string, string> {
  if (!ciphertext) return {};
  const key = configKey();
  if (!key) {
    throw new ConfigError(503, "ENCRYPTION_UNAVAILABLE", "cannot decrypt integration secret: CONFIG_ENC_KEY is not configured");
  }
  if (!isEncryptedBlob(ciphertext)) {
    throw new ConfigError(500, "DECRYPT_FAILED", "stored integration secret is malformed");
  }
  const out = decryptValue(ciphertext, key);
  if (out && typeof out === "object") return out as Record<string, string>;
  return {};
}

/** The masked display form of a set secret: "••••1234", or null when unset. */
export function maskLast4(last4: string | null | undefined): string | null {
  if (!last4) return null;
  return `••••${last4}`;
}

/** Derive the status of a freshly-written row that has not been tested yet. */
export function statusAfterWrite(enabled: boolean, hasSecret: boolean): "unconfigured" | "connected" | "failed" {
  return enabled && hasSecret ? "unconfigured" : "unconfigured";
}
