import type { DataKey, EnvelopeCiphertext, KmsProvider } from "./types.js";
import { KmsNotConfiguredError } from "./types.js";

/**
 * AwsKmsProvider — env-gated stub. This is HONEST: it does NOT pretend to talk
 * to AWS. It is "configured" only when both AWS_KMS_KEY_ID and AWS credentials
 * are present AND the optional @aws-sdk/client-kms peer is installed. Until then
 * every crypto call throws KmsNotConfiguredError so callers fail closed instead
 * of silently using fake ciphertext.
 *
 * To make it real: install @aws-sdk/client-kms, set AWS_KMS_KEY_ID + AWS creds,
 * and implement the four methods against GenerateDataKey / Encrypt / Decrypt /
 * (key rotation is managed by AWS KMS itself via `rotate()` -> UpdateKeyRotation).
 */
export class AwsKmsProvider implements KmsProvider {
  readonly name = "aws-kms";
  private readonly keyArn: string | undefined;

  constructor(keyArn: string | undefined = process.env.AWS_KMS_KEY_ID) {
    this.keyArn = keyArn;
  }

  isConfigured(): boolean {
    return Boolean(this.keyArn && (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ROLE_ARN || process.env.AWS_WEB_IDENTITY_TOKEN_FILE));
  }

  private ensure(): never {
    throw new KmsNotConfiguredError(
      "AWS KMS provider is not integrated in this environment. Set AWS_KMS_KEY_ID + AWS credentials " +
      "and install @aws-sdk/client-kms, or use LocalKmsProvider for dev/on-prem.",
    );
  }

  async generateDataKey(): Promise<DataKey> { return this.ensure(); }
  async encrypt(_plaintext: string | Buffer): Promise<EnvelopeCiphertext> { return this.ensure(); }
  async decrypt(_env: EnvelopeCiphertext): Promise<Buffer> { return this.ensure(); }
  async rotate(): Promise<{ keyId: string }> { return this.ensure(); }
}
