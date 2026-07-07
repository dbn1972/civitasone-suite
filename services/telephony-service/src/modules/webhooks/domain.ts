/**
 * Webhook signature validation — pure domain functions.
 *
 * Twilio uses HMAC-SHA1 over URL + sorted POST params.
 * Exotel uses timing-safe token comparison.
 *
 * These are extracted as pure functions for testability and reuse.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validate a Twilio webhook signature (HMAC-SHA1).
 *
 * Twilio computes the signature as:
 *   HMAC-SHA1(authToken, url + sorted(params.keys()).map(k => k + params[k]).join(""))
 * encoded as Base64.
 *
 * @param url - The full webhook URL (scheme + host + path, no query string)
 * @param params - The POST body key-value pairs
 * @param signature - The X-Twilio-Signature header value (Base64)
 * @param authToken - The Twilio auth token secret
 * @returns true if signature is valid
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): boolean {
  if (!authToken || !signature) return false;

  const keys = Object.keys(params).sort();
  const data = url + keys.map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");

  try {
    const sigBuf = Buffer.from(signature, "base64");
    const expectedBuf = Buffer.from(expected, "base64");
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Validate an Exotel webhook token using timing-safe comparison.
 *
 * @param providedToken - The token from the request (header or param)
 * @param configuredToken - The expected token from environment configuration
 * @returns true if token matches
 */
export function validateExotelToken(
  providedToken: string,
  configuredToken: string,
): boolean {
  if (!configuredToken || !providedToken) return false;

  try {
    const providedBuf = Buffer.from(providedToken, "utf8");
    const configuredBuf = Buffer.from(configuredToken, "utf8");
    if (providedBuf.length !== configuredBuf.length) return false;
    return timingSafeEqual(providedBuf, configuredBuf);
  } catch {
    return false;
  }
}
