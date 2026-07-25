/**
 * CAP-091 — pure domain logic for central config management.
 *
 * No I/O, no DB, no queue: the maker-checker + approvable + versioning guards,
 * plus AES-256-GCM encryption of sensitive config values. All deterministic and
 * unit-testable.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Error carrying an HTTP status + stable machine code for the route layer. */
export class ConfigError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type ChangeStatus = "pending" | "approved" | "rejected";

/**
 * Maker-checker: the approver must be a different principal than the person who
 * proposed the change. Segregation of duties — a proposer can never approve
 * their own config change.
 */
export function assertApproverDistinct(proposerId: string, approverId: string): void {
  if (proposerId === approverId) {
    throw new ConfigError(
      409,
      "MAKER_CHECKER_VIOLATION",
      "the approver must differ from the proposer of a config change",
    );
  }
}

/** Only a still-pending change request can be approved or rejected. */
export function assertPending(status: string): void {
  if (status !== "pending") {
    throw new ConfigError(
      409,
      "NOT_PENDING",
      `change request is '${status}', only 'pending' requests can be decided`,
    );
  }
}

/** The next version number for an entry (monotonic, starts at 1). */
export function nextVersion(currentVersion: number | null | undefined): number {
  return (currentVersion ?? 0) + 1;
}

// ── encryption of sensitive values (AES-256-GCM) ────────────────────────────

const ALGO = "aes-256-gcm";

/**
 * Derive a stable 32-byte key from the configured secret. Accepts a 64-char hex
 * key directly, otherwise hashes the passphrase to 32 bytes (SHA-256).
 */
export function deriveKey(secret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  return createHash("sha256").update(secret, "utf8").digest();
}

/** The env-configured config encryption key, or null when unset. */
export function configKey(): Buffer | null {
  const secret = process.env.CONFIG_ENC_KEY;
  if (!secret || secret.length === 0) return null;
  return deriveKey(secret);
}

/**
 * Encrypt a JSON-serialisable value to a compact `v1:<iv>:<tag>:<ciphertext>`
 * string (all base64). Round-trips via decryptValue.
 */
export function encryptValue(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a value produced by encryptValue back to its original JSON value. */
export function decryptValue(blob: string, key: Buffer): unknown {
  const parts = blob.split(":");
  const [prefix, ivB, tagB, ctB] = parts;
  if (parts.length !== 4 || prefix !== "v1" || !ivB || !tagB || !ctB) {
    throw new ConfigError(500, "DECRYPT_FAILED", "malformed encrypted config value");
  }
  const iv = Buffer.from(ivB, "base64");
  const tag = Buffer.from(tagB, "base64");
  const ct = Buffer.from(ctB, "base64");
  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    throw new ConfigError(500, "DECRYPT_FAILED", "could not decrypt config value (bad key or tampered ciphertext)");
  }
}

/** True when `blob` looks like an encryptValue() output. */
export function isEncryptedBlob(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("v1:") && v.split(":").length === 4;
}

/**
 * Prepare a value for storage: sensitive values are encrypted when a key is
 * configured. Returns the value to persist plus whether it is ciphertext.
 * A sensitive value with NO configured key is rejected fail-closed — we never
 * silently store a secret in plaintext.
 */
export function sealForStorage(
  value: unknown,
  sensitive: boolean,
  key: Buffer | null,
): { stored: unknown; encrypted: boolean } {
  if (!sensitive) return { stored: value, encrypted: false };
  if (!key) {
    throw new ConfigError(
      503,
      "ENCRYPTION_UNAVAILABLE",
      "a sensitive config value cannot be stored: CONFIG_ENC_KEY is not configured",
    );
  }
  return { stored: encryptValue(value, key), encrypted: true };
}

/**
 * Render a stored value for API display. Sensitive/encrypted values are masked
 * unless `reveal` is explicitly requested AND a key is available to decrypt.
 */
export function displayValue(
  stored: unknown,
  encrypted: boolean,
  opts: { reveal?: boolean; key?: Buffer | null } = {},
): unknown {
  if (!encrypted) return stored;
  if (opts.reveal && opts.key && isEncryptedBlob(stored)) {
    return decryptValue(stored, opts.key);
  }
  return "***";
}

/** Constant-time compare of two short secrets (defensive helper). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
