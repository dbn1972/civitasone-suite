export * from "./types.js";
export { LocalKmsProvider } from "./local-provider.js";
export { AwsKmsProvider } from "./aws-provider.js";
export * from "./certificates.js";

import type { KmsProvider } from "./types.js";
import { LocalKmsProvider } from "./local-provider.js";
import { AwsKmsProvider } from "./aws-provider.js";

/**
 * Select a KMS provider from the environment.
 *  - KMS_PROVIDER=aws  -> AwsKmsProvider (env-gated; honest not-configured stub)
 *  - otherwise         -> LocalKmsProvider (envelope encryption, real crypto)
 *
 * Never silently downgrades: if aws is requested but not configured, callers
 * get a provider whose crypto methods throw KmsNotConfiguredError.
 */
export function kmsFromEnv(env: NodeJS.ProcessEnv = process.env): KmsProvider {
  if ((env.KMS_PROVIDER ?? "local").toLowerCase() === "aws") {
    return new AwsKmsProvider(env.AWS_KMS_KEY_ID);
  }
  return new LocalKmsProvider(env.KMS_MASTER_KEY);
}
