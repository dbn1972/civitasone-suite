/**
 * DSC signing-secret protection (P0 security: DSC passphrase was plaintext in
 * the dscConfigUpsert queue message AND decrypted into the Redis-backed
 * dsc_config read cache).
 *
 * REUSES the service's existing field-encryption envelope
 * (src/shared/pii-crypto.ts: AES-256-GCM, "enc:v2:<keyid>:" envelope, keyring
 * for rotation via PII_ENC_KEY / PII_KEY_ID / PII_ENC_KEYRING / PII_ENC_SALT).
 * No new crypto, no new key.
 *
 * Invariants this module exists to enforce:
 *  - The passphrase is sealed in the ROUTE HANDLER, before the command is
 *    published, so the queue message, the outbox/DLQ, the consumer, the DB row
 *    and the read cache only ever see ciphertext.
 *  - The plaintext is only recovered by openDscPassphrase(), called by the
 *    loader right before the keystore is parsed for signing.
 *  - The P12 keystore bytes get the same envelope before they are written to
 *    object storage (the P12 is passphrase-protected, but a leaked object would
 *    otherwise be open to offline passphrase brute force).
 *  - Fail closed: if PII_ENC_KEY is missing, sealing throws (nothing is
 *    published / uploaded), and opening a sealed value throws PiiDecryptError.
 *
 * Rollout compatibility (legacy rows / objects written before this change):
 *  - openDscPassphrase() passes through a value without an "enc:" prefix
 *    (legacy plaintext row) — the prefix IS the per-row "is encrypted" marker.
 *  - openP12() passes through a raw DER keystore (legacy object).
 *  - scripts/backfill-dsc-secrets.mjs (backfill.ts) seals both in place.
 *
 * Never log any value passing through this module.
 */
import { decryptPii, encryptPii, isEncrypted } from "../../shared/pii-crypto.js";

/** Seal a cleartext passphrase -> "enc:v2:<keyid>:<b64>". Throws if no key. */
export function sealDscPassphrase(plain: string): string {
  return encryptPii(plain);
}

/** True if a stored/queued passphrase value is already sealed. */
export function isSealed(value: string): boolean {
  return isEncrypted(value);
}

/**
 * Recover the cleartext passphrase at the moment of use. Legacy plaintext rows
 * (pre-backfill) pass through unchanged; a sealed value with a missing/wrong
 * key throws PiiDecryptError (fail closed, message never contains the value).
 */
export function openDscPassphrase(stored: string): string {
  return decryptPii(stored);
}

/**
 * Seal P12 keystore bytes for object storage. The stored object is the UTF-8
 * envelope of the base64 keystore, so it starts with "enc:" — a raw PKCS#12
 * DER blob always starts with 0x30 (ASN.1 SEQUENCE), so the two can never be
 * confused.
 */
export function sealP12(p12: Buffer): Buffer {
  return Buffer.from(encryptPii(p12.toString("base64")), "utf8");
}

/** True if an object-storage keystore blob is in our envelope. */
export function isSealedP12(blob: Buffer): boolean {
  // Only the prefix is inspected; avoid decoding a large binary blob.
  return isEncrypted(blob.subarray(0, 16).toString("latin1"));
}

/** Recover the raw P12 keystore. Legacy (unsealed) DER passes through. */
export function openP12(blob: Buffer): Buffer {
  if (!isSealedP12(blob)) return blob;
  return Buffer.from(decryptPii(blob.toString("utf8")), "base64");
}
