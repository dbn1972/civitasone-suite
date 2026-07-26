/**
 * @civitasone/kms — key management abstraction (CAP-082).
 *
 * A single `KmsProvider` interface with two implementations:
 *  - LocalKmsProvider: real envelope encryption using a master key (dev / on-prem).
 *  - AwsKmsProvider: env-gated stub that is HONEST about not being configured
 *    (throws a clear error rather than pretending to call AWS).
 */

/** Envelope-encrypted payload. `keyId` identifies the master key version used. */
export interface EnvelopeCiphertext {
  keyId: string;
  /** base64 IV for the data-key encryption of the plaintext */
  iv: string;
  /** base64 GCM auth tag for the plaintext encryption */
  tag: string;
  /** base64 ciphertext of the plaintext (encrypted with the data key) */
  ciphertext: string;
  /** the data key, itself encrypted under the master key (base64) */
  encryptedDataKey: string;
}

/** Result of generating a data key (plaintext is used then discarded). */
export interface DataKey {
  keyId: string;
  plaintextKey: Buffer;
  encryptedDataKey: string; // base64, wrapped under the master key
}

export interface KmsProvider {
  readonly name: string;
  /** True when the provider is usable (keys present / SDK configured). */
  isConfigured(): boolean;
  /** Generate a fresh 256-bit data key, returned both plaintext and wrapped. */
  generateDataKey(): Promise<DataKey>;
  /** Envelope-encrypt arbitrary plaintext. */
  encrypt(plaintext: string | Buffer): Promise<EnvelopeCiphertext>;
  /** Reverse `encrypt`. Throws on tamper (GCM auth failure). */
  decrypt(env: EnvelopeCiphertext): Promise<Buffer>;
  /**
   * Rotate the active master key. Returns the new key id. Data encrypted under
   * older key ids remains decryptable (versioned keys retained).
   */
  rotate(): Promise<{ keyId: string }>;
}

export class KmsNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsNotConfiguredError";
  }
}
