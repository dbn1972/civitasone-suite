/**
 * Three-layer security model (Gmail-inspired):
 * 1. Browser/device — device_id + fingerprint + trust_token headers
 * 2. Session — Keycloak access + refresh tokens (PKCE, rotation)
 * 3. Step-up — short-lived elevated token for sensitive mutations
 */

export type SessionLayer = "device" | "session" | "step_up";

export type SecureSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  deviceId: string;
  deviceTrustToken?: string;
  stepUpToken?: string;
  stepUpExpiresAt?: number;
};

export type SecurityHeaders = {
  authorization: string;
  "x-device-id": string;
  "x-device-trust-token"?: string;
  "x-step-up-token"?: string;
  "x-correlation-id"?: string;
};

export function buildSecurityHeaders(
  session: SecureSession,
  correlationId?: string,
  requireStepUp = false,
): SecurityHeaders {
  if (requireStepUp && (!session.stepUpToken || (session.stepUpExpiresAt ?? 0) < Date.now())) {
    throw new Error("STEP_UP_REQUIRED");
  }
  const headers: SecurityHeaders = {
    authorization: `Bearer ${session.accessToken}`,
    "x-device-id": session.deviceId,
  };
  if (session.deviceTrustToken) headers["x-device-trust-token"] = session.deviceTrustToken;
  if (requireStepUp && session.stepUpToken) headers["x-step-up-token"] = session.stepUpToken;
  if (correlationId) headers["x-correlation-id"] = correlationId;
  return headers;
}

export function sessionFromTokens(opts: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  deviceId: string;
  deviceTrustToken?: string;
}): SecureSession {
  const session: SecureSession = {
    accessToken: opts.accessToken,
    expiresAt: Date.now() + opts.expiresIn * 1000,
    deviceId: opts.deviceId,
  };
  if (opts.refreshToken) session.refreshToken = opts.refreshToken;
  if (opts.deviceTrustToken) session.deviceTrustToken = opts.deviceTrustToken;
  return session;
}

export function isSessionExpired(session: SecureSession, skewMs = 30_000): boolean {
  return Date.now() >= session.expiresAt - skewMs;
}
