/** True when dev credential login (/auth/dev) is explicitly allowed. */
export function isDevLoginEnabled(): boolean {
  // SEC REM-01: dev-login is opt-in only. Never active unless ENABLE_DEV_LOGIN
  // is explicitly set to "true". Do not add a NODE_ENV fallback — that was the
  // vulnerability (any non-production deployment was automatically vulnerable).
  return process.env.ENABLE_DEV_LOGIN === "true";
}

/** Production UAT should use Keycloak OIDC at /auth/login. */
export function defaultLoginPath(): string {
  return isDevLoginEnabled() ? "/auth/dev" : "/auth/login";
}
