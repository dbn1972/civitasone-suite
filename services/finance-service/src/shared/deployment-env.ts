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

/**
 * The worker's outbox relay/purge needs a dedicated BYPASSRLS scanner connection. Returns the problem as an operator-readable
 * message (naming the exact variable to set), or null when the configuration is fine or the deployment is a sandbox.
 */
export function scannerConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (isSandboxDeployment(env)) return null;
  const scanner = env.FINANCE_SCANNER_DATABASE_URL ?? "";
  const primary = env.DATABASE_URL ?? "";
  if (scanner && scanner !== primary) return null;
  const why = !scanner ? "is not set" : "is identical to DATABASE_URL";
  return (
    `finance-worker refused to start: FINANCE_SCANNER_DATABASE_URL ${why}. In a production deployment set it to the ` +
    "connection string of the finance_scanner (BYPASSRLS) role, distinct from DATABASE_URL (needed for the outbox relay/purge " +
    `under FORCE RLS). NODE_ENV is "${env.NODE_ENV ?? ""}", which counts as production; for a non-production environment set ` +
    "NODE_ENV=development (or test), or PFMS_SANDBOX=true when NODE_ENV is something else such as staging."
  );
}
