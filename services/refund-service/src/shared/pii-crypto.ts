/**
 * refund-service: field-level PII encryption at rest (DPDP).
 *
 * Same AES-256-GCM envelope / key derivation / wire format as
 * finance-service, procurement-service and hrms-service
 * (`enc:v2:<keyid>:` + base64(12B IV || 16B tag || ct)); keyed from the generic
 * `PII_ENC_KEY` env var, which ecosystem.config.js populates from REFUND_PII_KEY.
 * No secret literal lives in source.
 *
 * Fail-closed: a missing/short key throws on first use (encrypt AND decrypt of
 * an enc: value). Legacy plaintext (no enc: prefix) passes through decryptPii
 * so rows written before this change stay readable.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const DEFAULT_SALT = "civitas-refund-pii";

export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

export class PiiKeyMissingError extends Error {
  readonly code = "ENCRYPTION_UNAVAILABLE";
  constructor() {
    super("PII_ENC_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.");
    this.name = "PiiKeyMissingError";
  }
}

interface Keyring { activeKeyId: string; keys: Map<string, Buffer> }
let cachedRing: Keyring | null = null;

function salt(): Buffer {
  const s = process.env.PII_ENC_SALT;
  return Buffer.from(s && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

function keyring(): Keyring {
  if (cachedRing) return cachedRing;
  const secret = process.env.PII_ENC_KEY;
  if (!secret || secret.length < 16) throw new PiiKeyMissingError();
  const activeKeyId = process.env.PII_ENC_KEY_ID && process.env.PII_ENC_KEY_ID.length > 0 ? process.env.PII_ENC_KEY_ID : "k1";
  const keys = new Map<string, Buffer>([[activeKeyId, scryptSync(secret, salt(), KEY_LEN)]]);
  cachedRing = { activeKeyId, keys };
  return cachedRing;
}

export function resetPiiKeyCache(): void {
  cachedRing = null;
}

/** True when a usable key is configured (does not throw). */
export function isPiiKeyConfigured(): boolean {
  const s = process.env.PII_ENC_KEY;
  return !!s && s.length >= 16;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_V2);
}

export function encryptPii(plain: string): string {
  const ring = keyring();
  const k = ring.keys.get(ring.activeKeyId)!;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
  return `${PREFIX_V2}${ring.activeKeyId}:${payload}`;
}

export function decryptPii(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext
  const ring = keyring();
  try {
    const rest = stored.slice(PREFIX_V2.length);
    const sep = rest.indexOf(":");
    if (sep < 0) throw new PiiDecryptError("malformed enc:v2 envelope (missing key id)");
    const k = ring.keys.get(rest.slice(0, sep));
    if (!k) throw new PiiDecryptError(`no PII key for key id "${rest.slice(0, sep)}"`);
    const raw = Buffer.from(rest.slice(sep + 1), "base64");
    const decipher = createDecipheriv(ALGO, k, raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("PII decryption failed (tampered or wrong key)", { cause: e });
  }
}

/**
 * Display mask for a bank account number: last 4 digits only. Works on both
 * ciphertext (decrypts first) and legacy plaintext. A value that cannot be
 * decrypted is fully masked rather than leaked or thrown.
 */
export function maskAccountNumber(stored: string): string {
  let plain: string;
  try {
    plain = decryptPii(stored);
  } catch {
    return "****";
  }
  const tail = plain.slice(-4);
  return `${"*".repeat(Math.max(plain.length - 4, 4))}${tail}`;
}
