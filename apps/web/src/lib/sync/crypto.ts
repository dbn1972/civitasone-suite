/**
 * WEB-1e (prompt 01-T5): per-session encryption for the local IndexedDB cache.
 *
 * The IndexedDB store previously held plaintext under a single DB name shared
 * across every user/tenant on a browser profile. This module encrypts sensitive
 * payloads with AES-GCM using a key derived from the session and held only in
 * memory + sessionStorage (dropped on logout / tab close). Combined with the
 * tenant+user DB namespacing in indexedDb.ts, two users on one machine can no
 * longer read each other's cached data.
 *
 * The key never leaves the device and is not persisted to disk (sessionStorage
 * is cleared on logout via wipeSessionKey() and naturally on browser close).
 */

const SESSION_KEY_STORAGE = "civitasone_sync_key";

let cachedKey: CryptoKey | null = null;

function toBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** Copy into a standalone ArrayBuffer so Web Crypto's strict BufferSource typing
 * is satisfied regardless of the source view's backing buffer. */
function ab(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function hasCrypto(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof sessionStorage !== "undefined";
}

/**
 * Resolve (or lazily create) the per-session AES-GCM key. The raw key material
 * is kept in sessionStorage so it survives reloads within the same tab session
 * but is gone after logout/close. If Web Crypto is unavailable we return null
 * and the store falls back to storing plaintext (degraded, but functional).
 */
export async function getSessionKey(): Promise<CryptoKey | null> {
  if (!hasCrypto()) return null;
  if (cachedKey) return cachedKey;

  let raw = sessionStorage.getItem(SESSION_KEY_STORAGE);
  if (!raw) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    raw = toB64(keyBytes);
    sessionStorage.setItem(SESSION_KEY_STORAGE, raw);
  }

  cachedKey = await crypto.subtle.importKey("raw", ab(toBytes(raw)), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

/** Drop the session key (logout). Encrypted rows become unreadable thereafter. */
export function wipeSessionKey(): void {
  cachedKey = null;
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(SESSION_KEY_STORAGE);
}

export type EncryptedBlob = { __enc: true; iv: string; ct: string };

export function isEncryptedBlob(v: unknown): v is EncryptedBlob {
  return typeof v === "object" && v !== null && (v as EncryptedBlob).__enc === true;
}

/** Encrypt an arbitrary JSON-serialisable value. Returns plaintext-passthrough if no key. */
export async function encryptJson(value: unknown): Promise<unknown> {
  const key = await getSessionKey();
  if (!key) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ab(iv) }, key, ab(data));
  return { __enc: true, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) } satisfies EncryptedBlob;
}

/** Decrypt a value produced by encryptJson. Non-encrypted values pass through. */
export async function decryptJson<T = unknown>(value: unknown): Promise<T> {
  if (!isEncryptedBlob(value)) return value as T;
  const key = await getSessionKey();
  if (!key) throw new Error("SYNC_DECRYPT_NO_KEY");
  const iv = toBytes(value.iv);
  const ct = toBytes(value.ct);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(iv) }, key, ab(ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
