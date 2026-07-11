/**
 * meeting-service — field-level PII & classified-content encryption at rest.
 *
 * DPDP Act 2023 (Req 15.3) / CERT-In (Req 16.2): participant PII (personal_email,
 * personal_phone) is stored as AES-256-GCM ciphertext, never cleartext. This is
 * an app-layer envelope integrated into Drizzle as a `customType`, so every read
 * transparently decrypts and every write transparently encrypts — repo/queries/
 * consumer code keep seeing CLEARTEXT while the column at rest holds CIPHERTEXT.
 *
 * Mirrors the established sibling implementations
 * (visitor-service / telephony-service / crm-service `shared/pii-crypto.ts`):
 * same wire format and scrypt key derivation, but keyed from MEETING_PII_KEY.
 *
 * Ciphertext wire formats (single text value):
 *   PII:        "enc:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ct )
 *   Classified: "cls:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ct )
 *
 * TWO KEY LAYERS:
 *   1. encryptedText  — keyed from MEETING_PII_KEY. For ordinary participant PII.
 *   2. classifiedText — keyed from MEETING_CLASSIFIED_KEY, a SEPARATE second-layer
 *      key for higher-sensitivity content associated with Confidential / Secret /
 *      Top_Secret meetings (the 5-level Confidentiality_Level model). Using a
 *      distinct key means a leak of the PII key does not expose classified content
 *      and vice-versa. NOTE: Drizzle `customType` codecs run without row/tenant
 *      context, so per-tenant key SELECTION cannot happen here; tenant scoping of
 *      classified data is enforced at the RLS + access-control layer
 *      (tenant_id + confidentiality_level), while this layer provides the
 *      at-rest cryptographic separation. The active classified key id and any
 *      retired keys are supplied per deployment (see MEETING_CLASSIFIED_KEY* env).
 *
 * FAIL-FAST (steering: Environment & Configuration):
 *   - MEETING_PII_KEY is REQUIRED (>=16 chars). Call `assertPiiKeyConfigured()`
 *     from app.ts / worker.ts so the service crashes at boot if it is unset,
 *     rather than starting green and failing-open. It also lazily throws on first
 *     encrypt/decrypt.
 *   - MEETING_CLASSIFIED_KEY is validated lazily on first classified read/write
 *     (fail-closed): a classified column cannot be processed without its key.
 *
 * KEY DERIVATION: scrypt (a real KDF) over the master secret + a salt. Salts are
 * read from MEETING_PII_SALT / MEETING_CLASSIFIED_SALT when configured; a fixed,
 * documented application salt is the fallback (acceptable because the master
 * secret is already high-entropy — configuring the salt is the better posture).
 *
 * ROTATION: v2 envelopes embed the key id, so old ciphertext stays decryptable
 * after the master key rotates — retired keys are supplied via
 * MEETING_PII_KEYRING / MEETING_CLASSIFIED_KEYRING as JSON { "<keyid>": "<secret>" }.
 *
 * NO secret literal lives in source — every key is injected via env.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_PII = "enc:v2:";
const PREFIX_CLASSIFIED = "cls:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

// Fixed fallback salts (used only when the matching *_SALT env is unset).
const DEFAULT_PII_SALT = "civitas-meeting-pii";
const DEFAULT_CLASSIFIED_SALT = "civitas-meeting-classified";

/** Typed, non-500 error for any decrypt failure (tamper, wrong key, corruption). */
export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  readonly httpStatus = 422;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

interface Keyring {
  activeKeyId: string;
  keys: Map<string, Buffer>; // keyid -> 32-byte AES key
  indexKey: Buffer; // domain-separated HMAC key for optional blind indexing
}

/** scrypt KDF -> 32-byte AES key. */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LEN);
}

function saltBuf(envName: string, fallback: string): Buffer {
  const s = process.env[envName];
  return Buffer.from(s && s.length > 0 ? s : fallback, "utf8");
}

/**
 * Build a keyring from a master-secret env + key-id env + keyring env. Shared by
 * both the PII and classified layers so their derivation/rotation behaviour is
 * identical, only the source secrets differ.
 */
function buildKeyring(opts: {
  masterEnv: string;
  keyIdEnv: string;
  keyringEnv: string;
  saltEnv: string;
  saltFallback: string;
  purpose: string;
}): Keyring {
  const secret = process.env[opts.masterEnv];
  if (!secret || secret.length < 16) {
    throw new Error(
      `${opts.masterEnv} is required (>=16 chars) for at-rest ${opts.purpose} encryption. ` +
        `Inject it from the secret manager.`,
    );
  }
  const salt = saltBuf(opts.saltEnv, opts.saltFallback);

  const keyIdRaw = process.env[opts.keyIdEnv];
  const activeKeyId = keyIdRaw && keyIdRaw.length > 0 ? keyIdRaw : "k1";

  const keys = new Map<string, Buffer>();
  keys.set(activeKeyId, deriveKey(secret, salt));

  // Optional retired keys for post-rotation reads.
  const raw = process.env[opts.keyringEnv];
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${opts.keyringEnv} is not valid JSON: ${String(e)}`);
    }
    if (parsed && typeof parsed === "object") {
      for (const [kid, kSecret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof kSecret === "string" && kSecret.length >= 16 && !keys.has(kid)) {
          keys.set(kid, deriveKey(kSecret, salt));
        }
      }
    }
  }

  const indexKey = scryptSync(secret, Buffer.concat([salt, Buffer.from(":blind-index")]), KEY_LEN);
  return { activeKeyId, keys, indexKey };
}

let cachedPiiRing: Keyring | null = null;
let cachedClassifiedRing: Keyring | null = null;

function piiKeyring(): Keyring {
  if (!cachedPiiRing) {
    cachedPiiRing = buildKeyring({
      masterEnv: "MEETING_PII_KEY",
      keyIdEnv: "MEETING_PII_KEY_ID",
      keyringEnv: "MEETING_PII_KEYRING",
      saltEnv: "MEETING_PII_SALT",
      saltFallback: DEFAULT_PII_SALT,
      purpose: "PII",
    });
  }
  return cachedPiiRing;
}

function classifiedKeyring(): Keyring {
  if (!cachedClassifiedRing) {
    cachedClassifiedRing = buildKeyring({
      masterEnv: "MEETING_CLASSIFIED_KEY",
      keyIdEnv: "MEETING_CLASSIFIED_KEY_ID",
      keyringEnv: "MEETING_CLASSIFIED_KEYRING",
      saltEnv: "MEETING_CLASSIFIED_SALT",
      saltFallback: DEFAULT_CLASSIFIED_SALT,
      purpose: "classified-content",
    });
  }
  return cachedClassifiedRing;
}

/** Test/maintenance hook: drop the cached keyrings (e.g. after an env change). */
export function resetPiiKeyCache(): void {
  cachedPiiRing = null;
  cachedClassifiedRing = null;
}

/**
 * Fail-fast PII key validation. Eagerly builds the PII keyring so a missing or
 * too-short MEETING_PII_KEY throws at boot (fail-closed) instead of the service
 * starting green and silently failing-open. Call from app.ts / worker.ts.
 */
export function assertPiiKeyConfigured(): void {
  piiKeyring();
}

// ─── Low-level GCM primitives ────────────────────────────────────────────────

function gcmEncrypt(ring: Keyring, prefix: string, plain: string): string {
  const k = ring.keys.get(ring.activeKeyId);
  if (!k) throw new Error("active key missing from keyring");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ct]).toString("base64");
  return `${prefix}${ring.activeKeyId}:${payload}`;
}

function gcmDecryptEnvelope(ring: Keyring, prefix: string, stored: string): string {
  const rest = stored.slice(prefix.length);
  const sep = rest.indexOf(":");
  if (sep < 0) throw new PiiDecryptError(`malformed ${prefix} envelope (missing key id)`);
  const keyId = rest.slice(0, sep);
  const k = ring.keys.get(keyId);
  if (!k) throw new PiiDecryptError(`no key for key id "${keyId}" (rotation/keyring gap)`);
  const raw = Buffer.from(rest.slice(sep + 1), "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ─── PII layer ───────────────────────────────────────────────────────────────

/** True if a stored value is in the PII ciphertext envelope. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_PII);
}

/** Encrypt a UTF-8 string -> "enc:v2:<keyid>:<base64>" using the active PII key. */
export function encryptPii(plain: string): string {
  return gcmEncrypt(piiKeyring(), PREFIX_PII, plain);
}

/**
 * Decrypt a PII envelope -> UTF-8 string. Passes through legacy plaintext (a
 * value written before the backfill, or NULL). Fail-closed (PiiDecryptError) on
 * tamper / wrong key / corruption.
 */
export function decryptPii(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  try {
    return gcmDecryptEnvelope(piiKeyring(), PREFIX_PII, stored);
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("PII decryption failed (tampered or wrong key)", { cause: e });
  }
}

// ─── Classified layer ────────────────────────────────────────────────────────

/** True if a stored value is in the classified ciphertext envelope. */
export function isClassified(value: string): boolean {
  return value.startsWith(PREFIX_CLASSIFIED);
}

/** Encrypt a UTF-8 string -> "cls:v2:<keyid>:<base64>" using the active classified key. */
export function encryptClassified(plain: string): string {
  return gcmEncrypt(classifiedKeyring(), PREFIX_CLASSIFIED, plain);
}

/**
 * Decrypt a classified envelope -> UTF-8 string. Passes through legacy plaintext.
 * Fail-closed (PiiDecryptError) on tamper / wrong key / corruption.
 */
export function decryptClassified(stored: string): string {
  if (!isClassified(stored)) return stored;
  try {
    return gcmDecryptEnvelope(classifiedKeyring(), PREFIX_CLASSIFIED, stored);
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("classified decryption failed (tampered or wrong key)", { cause: e });
  }
}

// ─── Masking helpers (non-admin reads / exports; never log raw PII) ──────────

/** Mask a cleartext email: keep first char + domain -> r***@example.gov.in */
export function maskEmail(value: string | null): string | null {
  if (!value) return value;
  const at = value.indexOf("@");
  if (at <= 0) return value.length <= 2 ? "**" : `${value.slice(0, 1)}***`;
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

/** Mask a cleartext phone number: keep the last 4 digits -> ******3210 */
export function maskPhone(value: string | null): string | null {
  if (!value) return value;
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Constant-time comparison of two hex strings (for blind-index equality checks). */
export function safeTimingEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Deterministic blind index: keyed HMAC over the normalized (trimmed +
 * lowercased) value. Lets exact-match lookups / de-dup work over ciphertext
 * columns without ever decrypting them (uses the PII keyring's index key).
 */
export function blindIndex(plain: string): string {
  return createHmac("sha256", piiKeyring().indexKey).update(plain.trim().toLowerCase(), "utf8").digest("hex");
}

// ─── Drizzle custom column types ─────────────────────────────────────────────

/**
 * `encryptedText()` — a `text` column whose application value is the cleartext
 * string, transparently AES-256-GCM encrypted on write and decrypted on read.
 * Use for participant PII (personal_email, personal_phone).
 */
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

/**
 * `classifiedText()` — second-layer `text` column keyed from MEETING_CLASSIFIED_KEY,
 * for higher-sensitivity content on Confidential/Secret/Top_Secret meetings.
 * Cryptographically separated from ordinary PII so a compromise of one key does
 * not expose the other.
 */
export const classifiedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: string): string {
    return encryptClassified(value);
  },
  fromDriver(value: string): string {
    return decryptClassified(value);
  },
});
