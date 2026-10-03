/**
 * Field-level secret sealing for admin-service (platform-integrations).
 *
 * REUSES the fleet's PII/secret envelope and keyring pattern (see payroll-service
 * shared/pii-crypto.ts, which sealed the DSC passphrase the same way):
 *
 *   "enc:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ciphertext )
 *
 *   - AES-256-GCM, key derived with scrypt from PII_ENC_KEY (+ PII_ENC_SALT).
 *   - PII_KEY_ID names the active key (default "k1"); retired keys come from
 *     PII_ENC_KEYRING = {"<keyid>":"<secret>"} so old ciphertext stays readable
 *     after a rotation.
 *   - Dev: PII_ENC_KEY comes from the on-host key file (ecosystem.config.js).
 *     Production: injected by the secret manager (the keystore abstraction).
 *
 * Fail closed: sealing with no key throws SecretKeyUnavailableError (the route
 * answers 503, nothing is published or stored); a tampered or wrong-key value
 * throws SecretDecryptError. Neither message ever contains a secret value.
 * Unlike the HRMS/payroll column type there is NO plaintext pass-through: a
 * value without the "enc:v2:" prefix is rejected, so a plaintext secret can
 * never be read back as if it were sealed.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const DEFAULT_SALT = "civitas-admin-secrets";

export class SecretKeyUnavailableError extends Error {
  readonly code = "ENCRYPTION_UNAVAILABLE";
  constructor() {
    super("secret encryption key is not configured (PII_ENC_KEY)");
    this.name = "SecretKeyUnavailableError";
  }
}

export class SecretDecryptError extends Error {
  readonly code = "SECRET_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretDecryptError";
  }
}

interface Keyring {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

let cached: Keyring | null = null;
let cachedFingerprint = "";

function salt(): Buffer {
  const s = process.env.PII_ENC_SALT;
  return Buffer.from(s && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

function ring(): Keyring {
  const master = process.env.PII_ENC_KEY;
  if (!master || master.length < 16) throw new SecretKeyUnavailableError();
  const fingerprint = `${master}|${process.env.PII_KEY_ID ?? ""}|${process.env.PII_ENC_KEYRING ?? ""}|${process.env.PII_ENC_SALT ?? ""}`;
  if (cached && cachedFingerprint === fingerprint) return cached;

  const activeKeyId = process.env.PII_KEY_ID && process.env.PII_KEY_ID.length > 0 ? process.env.PII_KEY_ID : "k1";
  const keys = new Map<string, Buffer>();
  keys.set(activeKeyId, scryptSync(master, salt(), KEY_LEN));
  const raw = process.env.PII_ENC_KEYRING;
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SecretKeyUnavailableError();
    }
    if (parsed && typeof parsed === "object") {
      for (const [kid, kSecret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof kSecret === "string" && kSecret.length >= 16 && !keys.has(kid)) {
          keys.set(kid, scryptSync(kSecret, salt(), KEY_LEN));
        }
      }
    }
  }
  cached = { activeKeyId, keys };
  cachedFingerprint = fingerprint;
  return cached;
}

/** True when a usable key is configured (boot/readiness probe; never throws). */
export function secretKeyConfigured(): boolean {
  try {
    ring();
    return true;
  } catch {
    return false;
  }
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Seal a UTF-8 secret -> "enc:v2:<keyid>:<b64>". Throws SecretKeyUnavailableError with no key. */
export function sealSecret(plain: string): string {
  const r = ring();
  const key = r.keys.get(r.activeKeyId);
  if (!key) throw new SecretKeyUnavailableError();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${r.activeKeyId}:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

/** Open a sealed secret. Rejects anything that is not a valid envelope. */
export function openSecret(stored: string): string {
  if (!isSealed(stored)) throw new SecretDecryptError("stored secret is not a sealed envelope");
  const r = ring();
  const rest = stored.slice(PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) throw new SecretDecryptError("malformed secret envelope (missing key id)");
  const key = r.keys.get(rest.slice(0, sep));
  if (!key) throw new SecretDecryptError("no key for the secret's key id (rotation/keyring gap)");
  try {
    const raw = Buffer.from(rest.slice(sep + 1), "base64");
    const decipher = createDecipheriv(ALGO, key, raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new SecretDecryptError("secret decryption failed (tampered or wrong key)", { cause: e });
  }
}
