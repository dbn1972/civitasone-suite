/**
 * Which online payment mode the citizen apply flow runs in.
 *
 * "sandbox" is a fake-success test capture (no money moves). It is only ever
 * selected when NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX is exactly "true" AND the
 * build is not production — mirroring the server gate
 * (CITIZEN_PAYMENTS_SANDBOX_ENABLED, always off in production). Everything
 * else is "gateway".
 */
export type CitizenPaymentMode = "sandbox" | "gateway";

export function resolveCitizenPaymentMode(
  env: { NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX?: string | undefined; NODE_ENV?: string | undefined } = process.env,
): CitizenPaymentMode {
  if (env.NODE_ENV === "production") return "gateway";
  return env.NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX === "true" ? "sandbox" : "gateway";
}
