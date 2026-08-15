/**
 * Webhook domain logic — HMAC signing and endpoint URL validation.
 */
import { createHmac } from "node:crypto";

/** Compute HMAC-SHA256 hex signature for a webhook payload body. */
export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * SSRF-safe validation for webhook endpoint URLs.
 *
 * Rules:
 *   1. Must be a well-formed URL.
 *   2. Protocol must be https: (http: rejected to prevent plaintext delivery
 *      and to reduce the surface for header-injection attacks).
 *   3. Hostname must not resolve to a private/link-local/loopback range so
 *      that a malicious tenant cannot use the notification worker as an SSRF
 *      proxy to reach internal services (metadata APIs, Redis, RDS, etc.).
 *
 * Note: blocking is done on the *literal* hostname, not via DNS resolution.
 * A separate DNS-rebinding defence (resolving + re-checking after connect)
 * would be ideal but is outside the scope of this validation helper.
 */
export function validateEndpointUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();

  // Loopback / wildcard
  if (host === "localhost" || host === "0.0.0.0") return false;

  // IPv4 private + link-local + loopback prefixes
  const blockedPrefixes = [
    "127.",       // loopback
    "10.",        // RFC-1918 class A
    "192.168.",   // RFC-1918 class C
    "169.254.",   // link-local (AWS instance metadata et al.)
    "0.",         // "this" network
    // RFC-1918 class B: 172.16.0.0/12 = 172.16 – 172.31
    "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.",
    "172.28.", "172.29.", "172.30.", "172.31.",
  ];

  if (blockedPrefixes.some((prefix) => host.startsWith(prefix))) return false;

  // Bare IPv6 loopback [::1]
  if (host === "::1" || host === "[::1]") return false;
  // IPv6 link-local fe80::/10
  if (host.startsWith("fe80") || host.startsWith("[fe80")) return false;

  return true;
}
