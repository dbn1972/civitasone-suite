/**
 * Same-origin post-login redirect guard (GAP-AUTH-LOGIN-02).
 *
 * A bare `startsWith("/") && !startsWith("//")` check is not enough: WHATWG URL
 * parsing treats "\" as "/" for special schemes, so "/\\evil.com" resolves to
 * host evil.com. We reject backslashes and control characters outright, then
 * parse against a fixed base and require the origin to be unchanged.
 */
const BASE = "https://same-origin.invalid";

export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex -- rejecting control chars is the point
  if (/[\\\\\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const u = new URL(next, BASE);
    if (u.origin !== BASE) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}
