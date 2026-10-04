/**
 * Sandbox vs production for money paths (PFMS signing / release). FAIL CLOSED: sandbox behaviour (mock signer, mock
 * signature accepted, an unconfigured SFTP gateway treated as "sent") is an explicit allowlist, never "anything that
 * is not exactly the string production". So an unset NODE_ENV, "prod", "staging" or a typo are all PRODUCTION.
 *
 *   NODE_ENV = development | test  -> sandbox
 *   PFMS_SANDBOX=true              -> sandbox, as an explicit opt-in for a non-prod environment that has some other
 *                                     NODE_ENV (e.g. staging). It is REFUSED when NODE_ENV is production.
 *   anything else (including unset) -> production
 */
export function isSandboxDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV ?? "";
  if (nodeEnv === "production") return false;
  if (nodeEnv === "development" || nodeEnv === "test") return true;
  return env.PFMS_SANDBOX === "true";
}

export const isProductionDeployment = (env: NodeJS.ProcessEnv = process.env): boolean => !isSandboxDeployment(env);
