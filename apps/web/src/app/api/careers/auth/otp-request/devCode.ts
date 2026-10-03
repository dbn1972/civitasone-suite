/**
 * GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-03: the one-time code must only ever reach the browser by
 * email. The service echoes it (devCode) when ALLOW_DEV_OTP_ECHO=true, and this proxy forwards
 * that echo only under the same explicit flag in a non-production build; otherwise it is
 * stripped even if an upstream misconfiguration leaks it.
 */
export function devOtpEchoAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.ALLOW_DEV_OTP_ECHO === "true" && env.NODE_ENV !== "production";
}

export function stripDevCode(text: string, allow: boolean): string {
  if (allow) return text;
  try {
    const body = JSON.parse(text) as Record<string, unknown> | null;
    if (body && typeof body === "object" && "devCode" in body) {
      delete body.devCode;
      return JSON.stringify(body);
    }
  } catch {
    // Not JSON: nothing to strip.
  }
  return text;
}
