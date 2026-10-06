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

/**
 * GAP-AUTH-DEV-01: fail closed if the dev-login bypass is misconfigured.
 *
 * The dev-login route mints its own signed session cookie, bypassing Keycloak.
 * That is acceptable ONLY in a non-production environment that has deliberately
 * set a real signing secret and a non-empty shared demo password. If any of
 * those invariants is broken we throw rather than silently granting access:
 *   - never active in production (NODE_ENV === "production");
 *   - JWT_SECRET must be set explicitly (no public fallback literal);
 *   - DEV_LOGIN_PASSWORD must be a non-empty string (empty would match every
 *     persona on a bare POST).
 *
 * Returns the validated { secret, password } so callers never re-read the env
 * with their own (laxer) fallbacks. Throws on any violation.
 */
export function assertDevLoginConfig(): { secret: string; password: string } {
  if ((process.env.NODE_ENV ?? "") === "production") {
    throw new Error(
      "dev-login is disabled in production: unset ENABLE_DEV_LOGIN or deploy with NODE_ENV!=production",
    );
  }
  const secret = process.env.JWT_SECRET ?? "";
  if (secret.length === 0) {
    throw new Error("dev-login requires JWT_SECRET to be set explicitly (no default signing secret)");
  }
  const password = process.env.DEV_LOGIN_PASSWORD ?? "";
  if (password.length === 0) {
    throw new Error("dev-login requires a non-empty DEV_LOGIN_PASSWORD");
  }
  return { secret, password };
}
