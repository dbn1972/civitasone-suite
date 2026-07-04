/**
 * Field-level PII encryption at rest (mirrors hrms-service implementation).
 *
 * App-layer AES-256-GCM envelope, integrated into Drizzle as a `customType`.
 * Every read transparently decrypts and every write transparently encrypts.
 *
 * Ciphertext wire formats:
 *   v1 (legacy):  "enc:v1:"            + base64( 12B IV || 16B GCM tag || ct )
 *   v2 (current): "enc:v2:<keyid>:"    + base64( 12B IV || 16B GCM tag || ct )
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_V1 = "enc:v1:";
const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const DEFAULT_SALT = "civitas-proc-pii";

export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

function readMasterSecret(): string {
  const secret = process.env.PII_ENC_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "PII_ENC_KEY is required (>=16 chars) for at-rest PII encryption.",
    );
  }
  return secret;
}

function saltBuf(): Buffer {
  const s = process.env.PII_ENC_SALT;
  return Buffer.from(s && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

function deriveV2Key(secret: string): Buffer {
  return scryptSync(secret, saltBuf(), KEY_LEN);
}

function deriveV1Key(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

interface Keyring {
  activeKeyId: string;
  v2: Map<string, Buffer>;
  v1: Buffer;
}

let cachedRing: Keyring | null = null;

function keyring(): Keyring {
  if (cachedRing) return cachedRing;
  const secret = readMasterSecret();
  const activeKeyId = process.env.PII_KEY_ID && process.env.PII_KEY_ID.length > 0
    ? process.env.PII_KEY_ID
    : "k1";

  const v2 = new Map<string, Buffer>();
  v2.set(activeKeyId, deriveV2Key(secret));

  const raw = process.env.PII_ENC_KEYRING;
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (e) {
      throw new Error(`PII_ENC_KEYRING is not valid JSON: ${String(e)}`);
    }
    if (parsed && typeof parsed === "object") {
      for (const [kid, kSecret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof kSecret === "string" && kSecret.length >= 16 && !v2.has(kid)) {
          v2.set(kid, deriveV2Key(kSecret));
        }
      }
    }
  }

  cachedRing = { activeKeyId, v2, v1: deriveV1Key(secret) };
  return cachedRing;
}

export function resetPiiKeyCache(): void { cachedRing = null; }

export function encryptPii(plain: string): string {
  const ring = keyring();
  const k = ring.v2.get(ring.activeKeyId)!;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ct]).toString("base64");
  return `${PREFIX_V2}${ring.activeKeyId}:${payload}`;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2);
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
  if (!isEncrypted(stored)) return stored;
  const ring = keyring();
  try {
    if (stored.startsWith(PREFIX_V2)) {
      const rest = stored.slice(PREFIX_V2.length);
      const sep = rest.indexOf(":");
      if (sep < 0) throw new PiiDecryptError("malformed enc:v2 envelope");
      const keyId = rest.slice(0, sep);
      const k = ring.v2.get(keyId);
      if (!k) throw new PiiDecryptError(`no PII key for key id "${keyId}"`);
      return gcmDecrypt(k, Buffer.from(rest.slice(sep + 1), "base64"));
    }
    return gcmDecrypt(ring.v1, Buffer.from(stored.slice(PREFIX_V1.length), "base64"));
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("PII decryption failed", { cause: e });
  }
}

/** Drizzle custom column type: text encrypted at rest, decrypted on read. */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() { return "text"; },
  toDriver(value: string): string { return encryptPii(value); },
  fromDriver(value: string): string { return decryptPii(value); },
});
