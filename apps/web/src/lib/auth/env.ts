/** True when dev credential login (/auth/dev) is explicitly allowed. */
export function isDevLoginEnabled(): boolean {
  if (process.env.ENABLE_DEV_LOGIN === "true") return true;
  return process.env.NODE_ENV !== "production";
}

/** Production UAT should use Keycloak OIDC at /auth/login. */
export function defaultLoginPath(): string {
  return isDevLoginEnabled() ? "/auth/dev" : "/auth/login";
}
