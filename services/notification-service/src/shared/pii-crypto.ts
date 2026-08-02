/**
 * notification-service: field-level PII encryption at rest (DPDP Act 2023).
 *
 * App-layer AES-256-GCM envelope wired into Drizzle as a `customType`, so every
 * read transparently decrypts and every write transparently encrypts. Mirrors
 * the crm-service / visitor-service implementations (same wire format and key
 * derivation) but is keyed from NOTIFICATION_PII_KEY.
 *
 * Ciphertext wire format (single text value):
 *   v2: "enc:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ct )
 *
 * WHY a blind index too: a suppression list has to answer "is this recipient
 * suppressed?" with an equality lookup, and ciphertext is non-deterministic
 * (random IV per write) so `WHERE recipient = $1` can never match. The blind
 * index is a keyed HMAC-SHA256 over the normalised value, stored in a separate
 * plain-text column, which keeps the unique constraint and the lookup working
 * without ever decrypting the PII column.
 *
 * Fail-closed: a missing/short NOTIFICATION_PII_KEY throws at first use. No
 * secret literal lives in source — the key is injected via env.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

/** Fallback salt used only when NOTIFICATION_PII_SALT is unset. */
const DEFAULT_SALT = "civitas-notification-pii";

export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

function readMasterSecret(): string {
  const secret = process.env.NOTIFICATION_PII_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "NOTIFICATION_PII_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.",
    );
  }
  return secret;
}

function saltBuf(): Buffer {
  const s = process.env.NOTIFICATION_PII_SALT;
  return Buffer.from(s && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

function deriveV2Key(secret: string): Buffer {
  return scryptSync(secret, saltBuf(), KEY_LEN);
}

interface Keyring {
  activeKeyId: string;
  v2: Map<string, Buffer>;
  indexKey: Buffer;
}

let cachedRing: Keyring | null = null;

function keyring(): Keyring {
  if (cachedRing) return cachedRing;
  const secret = readMasterSecret();
  const activeKeyId =
    process.env.NOTIFICATION_PII_KEY_ID && process.env.NOTIFICATION_PII_KEY_ID.length > 0
      ? process.env.NOTIFICATION_PII_KEY_ID
      : "k1";

  const v2 = new Map<string, Buffer>();
  v2.set(activeKeyId, deriveV2Key(secret));

  // Retired keys stay readable during rotation: {"k0":"<old secret>", ...}.
  const raw = process.env.NOTIFICATION_PII_KEYRING;
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`NOTIFICATION_PII_KEYRING is not valid JSON: ${String(e)}`);
    }
    if (parsed && typeof parsed === "object") {
      for (const [kid, kSecret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof kSecret === "string" && kSecret.length >= 16 && !v2.has(kid)) {
          v2.set(kid, deriveV2Key(kSecret));
        }
      }
    }
  }

  // Blind-index HMAC key, domain-separated from the encryption key.
  const indexKey = scryptSync(secret, Buffer.concat([saltBuf(), Buffer.from(":blind-index")]), KEY_LEN);

  cachedRing = { activeKeyId, v2, indexKey };
  return cachedRing;
}

/** Test/rotation helper — drops the cached derived keys. */
export function resetPiiKeyCache(): void {
  cachedRing = null;
}

export function encryptPii(plain: string): string {
  const ring = keyring();
  const k = ring.v2.get(ring.activeKeyId);
  if (!k) throw new Error("active PII key missing from keyring");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ct]).toString("base64");
  return `${PREFIX_V2}${ring.activeKeyId}:${payload}`;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_V2);
}

function gcmDecrypt(k: Buffer, raw: Buffer): string {
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function decryptPii(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext / not yet backfilled
  const ring = keyring();
  try {
    const rest = stored.slice(PREFIX_V2.length);
    const sep = rest.indexOf(":");
    if (sep < 0) throw new PiiDecryptError("malformed enc:v2 envelope (missing key id)");
    const keyId = rest.slice(0, sep);
    const k = ring.v2.get(keyId);
    if (!k) throw new PiiDecryptError(`no PII key for key id "${keyId}" (rotation/keyring gap)`);
    return gcmDecrypt(k, Buffer.from(rest.slice(sep + 1), "base64"));
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("PII decryption failed (tampered or wrong key)", { cause: e });
  }
}

/**
 * Deterministic blind index: keyed HMAC over the normalised (trimmed +
 * lowercased) value. Stored in its own plain-text column so equality lookups
 * and unique constraints work over an encrypted column.
 */
export function blindIndex(plain: string): string {
  const ring = keyring();
  const norm = plain.trim().toLowerCase();
  return createHmac("sha256", ring.indexKey).update(norm, "utf8").digest("hex");
}

/** Drizzle custom column type: cleartext in app, AES-256-GCM ciphertext at rest. */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: string): string {
    return encryptPii(value);
  },
  fromDriver(value: string): string {
    return decryptPii(value);
  },
});
