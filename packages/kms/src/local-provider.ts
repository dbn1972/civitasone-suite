import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { DataKey, EnvelopeCiphertext, KmsProvider } from "./types.js";
import { KmsNotConfiguredError } from "./types.js";

const ALGO = "aes-256-gcm";

function keyId(masterKey: Buffer): string {
  // Deterministic, non-reversible id for a master key version.
  return "local-" + createHash("sha256").update(masterKey).digest("hex").slice(0, 16);
}

/**
 * LocalKmsProvider — real envelope encryption for dev / on-prem deployments.
 *
 * A 256-bit master key wraps per-message data keys. Each `encrypt` mints a fresh
 * data key, encrypts the plaintext under it (AES-256-GCM), then wraps the data
 * key under the master key. Rotation adds a new master key version while keeping
 * old versions so historical ciphertext stays decryptable.
 */
export class LocalKmsProvider implements KmsProvider {
  readonly name = "local";
  private versions = new Map<string, Buffer>();
  private activeId: string;

  /**
   * @param masterKey 32-byte master key. Provide a base64 string, a Buffer, or
   *   omit to read `KMS_MASTER_KEY` (base64) from the environment.
   */
  constructor(masterKey?: Buffer | string) {
    const mk = LocalKmsProvider.resolveMasterKey(masterKey);
    this.activeId = keyId(mk);
    this.versions.set(this.activeId, mk);
  }

  static resolveMasterKey(masterKey?: Buffer | string): Buffer {
    if (masterKey) {
      const buf = typeof masterKey === "string" ? Buffer.from(masterKey, "base64") : masterKey;
      if (buf.length !== 32) throw new KmsNotConfiguredError("KMS master key must be 32 bytes (256-bit)");
      return buf;
    }
    const env = process.env.KMS_MASTER_KEY;
    if (!env) throw new KmsNotConfiguredError("KMS_MASTER_KEY not set (base64-encoded 32-byte key)");
    const buf = Buffer.from(env, "base64");
    if (buf.length !== 32) throw new KmsNotConfiguredError("KMS_MASTER_KEY must decode to 32 bytes");
    return buf;
  }

  /** Convenience for tests / bootstrap: a fresh random master key (base64). */
  static generateMasterKey(): string {
    return randomBytes(32).toString("base64");
  }

  isConfigured(): boolean {
    return this.versions.size > 0;
  }

  private wrap(dataKey: Buffer): { encryptedDataKey: string; keyId: string } {
    const master = this.versions.get(this.activeId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, master, iv);
    const enc = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    // encryptedDataKey layout: iv(12) | tag(16) | ciphertext
    return { encryptedDataKey: Buffer.concat([iv, tag, enc]).toString("base64"), keyId: this.activeId };
  }

  private unwrap(encryptedDataKey: string, kid: string): Buffer {
    const master = this.versions.get(kid);
    if (!master) throw new KmsNotConfiguredError(`master key version ${kid} not available (cannot decrypt)`);
    const raw = Buffer.from(encryptedDataKey, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, master, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  async generateDataKey(): Promise<DataKey> {
    const plaintextKey = randomBytes(32);
    const { encryptedDataKey, keyId: kid } = this.wrap(plaintextKey);
    return { keyId: kid, plaintextKey, encryptedDataKey };
  }

  async encrypt(plaintext: string | Buffer): Promise<EnvelopeCiphertext> {
    const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
    const { plaintextKey, encryptedDataKey, keyId: kid } = await this.generateDataKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, plaintextKey, iv);
    const ct = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    plaintextKey.fill(0); // discard plaintext data key
    return {
      keyId: kid, iv: iv.toString("base64"), tag: tag.toString("base64"),
      ciphertext: ct.toString("base64"), encryptedDataKey,
    };
  }

  async decrypt(env: EnvelopeCiphertext): Promise<Buffer> {
    const dataKey = this.unwrap(env.encryptedDataKey, env.keyId);
    const decipher = createDecipheriv(ALGO, dataKey, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    const out = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]);
    dataKey.fill(0);
    return out;
  }

  async rotate(): Promise<{ keyId: string }> {
    const next = randomBytes(32);
    const id = keyId(next);
    this.versions.set(id, next);
    this.activeId = id;
    return { keyId: id };
  }
}
