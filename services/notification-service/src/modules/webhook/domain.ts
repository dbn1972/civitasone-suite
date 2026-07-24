/**
 * Webhook domain logic — HMAC signing and endpoint URL validation.
 */
import { createHmac } from "node:crypto";

/** Compute HMAC-SHA256 hex signature for a webhook payload body. */
export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Validate that an endpoint URL uses HTTPS protocol. */
export function validateEndpointUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}
