/**
 * URL hardening helpers.
 *
 * GAP-CRM-ACCOUNTS-DETAIL-05: a stored website is rendered into an anchor
 * `href`. A `javascript:`/`data:`/`vbscript:` value would execute on click,
 * and a bare domain ("example.com") becomes a relative in-app link. Validate
 * and normalise before trusting any user-supplied URL in markup.
 */

/**
 * Normalise a raw user-supplied URL to a safe absolute http(s) URL, or return
 * null when it cannot be made safe.
 *
 * - trims surrounding whitespace;
 * - prefixes `https://` when no scheme is present (so a bare domain becomes an
 *   absolute external link, not an in-app relative path);
 * - allows ONLY the http and https schemes — anything else (javascript:,
 *   data:, mailto:, ftp:, …) returns null;
 * - returns null for anything that does not parse as a URL with a host.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // A scheme is "word chars + :"; if there's no scheme at all, assume https.
  // We check against the raw string (not the parsed URL) so "javascript:..."
  // is caught before the URL parser can normalise it away.
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.toString();
}
