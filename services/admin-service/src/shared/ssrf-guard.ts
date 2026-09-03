/**
 * Shared SSRF guard for admin-service.
 *
 * H6 FIX / SSRF FIX: single source of truth for the "block private/loopback/
 * link-local/metadata destinations" check used by any code path that dials an
 * admin-supplied host or URL (outbound webhooks AND integration-settings test
 * probes). Blocks:
 *   - non-http(s) schemes (file://, gopher://, ftp://, javascript:, data:, …)
 *   - loopback, 0.0.0.0, RFC1918, link-local (169.254/fe80), IPv6 ULA
 *   - cloud metadata endpoints (169.254.169.254 / metadata.google.internal)
 * and re-resolves DNS (A/AAAA) to defeat rebinding — a hostname that resolves
 * to any private address is blocked.
 *
 * Extracted verbatim from webhooks/routes.ts so there is ONE implementation.
 * Behavior must remain identical for the webhook guard.
 */
import { resolve4, resolve6 } from "node:dns/promises";
import net from "node:net";

// Shared IPv4-octet check used both for plain IPv4 literals and for the IPv4
// address embedded in an IPv4-mapped IPv6 literal (::ffff:a.b.c.d). Only the
// first two octets are needed by any of the existing ranges.
function isPrivateIpv4Octets(a: number, b: number): boolean {
  if (a === 10) return true;                           // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12
  if (a === 192 && b === 168) return true;              // 192.168.0.0/16
  if (a === 169 && b === 254) return true;              // link-local (incl. cloud metadata)
  if (a === 127) return true;                           // loopback
  if (a === 0) return true;                             // 0.0.0.0/8
  return false;
}

// A raw string is a candidate for the obfuscated-IPv4-literal canonicalizer
// below only if it's built entirely from digits, hex letters, "x" (for a
// "0x…" prefix) and dots, and contains at least one digit. This deliberately
// excludes ordinary hostnames (which contain letters like g/o/m/etc. outside
// [0-9a-fx.]) so the round-trip below only ever fires on genuinely
// numeric-shaped input.
const IPV4_OBFUSCATION_CANDIDATE = /^[0-9a-fx.]+$/i;

// Attempts to canonicalize `normalized` as an obfuscated IPv4 literal
// (octal "0177.0.0.1", pure 32-bit decimal "2130706433", hex "0x7f.0.0.1"/
// "0x7f000001", or shorthand "127.1"). `new URL('http://' + h +
// '/').hostname` implements the WHATWG "IPv4 parser" algorithm (explicitly
// modeled on inet_aton) and folds all of these down to a canonical
// "a.b.c.d" string — verified to agree with dns.lookup()'s resolution
// (what net.connect()/tls.connect() actually use) for every obfuscated form
// tested. Returns the canonical "a.b.c.d" string if `normalized` is
// confidently an IPv4 literal in some spelling, or null otherwise (e.g. a
// genuine hostname that happens to be composed of digits/hex-letters/dots,
// or malformed input) — callers must not treat null as "safe", only as
// "not an IPv4-literal spelling".
function canonicalizeObfuscatedIpv4(normalized: string): string | null {
  if (!(IPV4_OBFUSCATION_CANDIDATE.test(normalized) && /\d/.test(normalized))) return null;
  try {
    const candidate = new URL(`http://${normalized}/`).hostname;
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

// Returns true if `normalized` is confidently recognizable as SOME spelling
// of an IP literal: canonical or non-canonical IPv6 (net.isIP() accepts
// both), a zone-ID-suffixed IPv6 literal (net.isIP() accepts these too —
// checked explicitly as well, for defense in depth independent of Node's
// parser behavior), or an obfuscated (octal/decimal/hex/shorthand) IPv4
// literal. Used to decide whether a bare host string should be routed
// through isPrivateIp()'s deterministic literal-parsing path or treated as
// a genuine hostname requiring DNS resolution — DNS resolution must only
// ever be attempted for input that is NOT some spelling of an IP address,
// since dns.lookup() (what net.connect()/tls.connect() actually use) and a
// live resolve4/resolve6 call can behave very differently for IP-literal
// input depending on the resolver.
function isRecognizableIpLiteral(normalized: string): boolean {
  if (net.isIP(normalized) !== 0) return true;
  if (normalized.includes("%")) return true; // zone-ID suffix — see isPrivateIp
  return canonicalizeObfuscatedIpv4(normalized) !== null;
}

export function isPrivateIp(ip: string): boolean {
  // Defensive normalization: strip a URL-hostname's IPv6 brackets (e.g.
  // "[fe80::1]" from `new URL(...).hostname`) and lowercase, so this function
  // is safe to call with either bracketed or bare IPv6 literals regardless of
  // whether the caller already normalized.
  let normalized = String(ip ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");

  // --- Canonicalize non-canonical IPv6 literals ---------------------------
  // net.isIP() (and therefore net.connect()/tls.connect(), which use the
  // same underlying parser) accepts many non-canonical spellings of the same
  // IPv6 address — fully-expanded zero groups, "::" collapsing a different
  // run of zeros, mixed padding, etc. — that the regexes below only
  // recognize in their single canonical, maximally-compressed spelling
  // (e.g. "::ffff:a9fe:a9fe"). "0:0:0:0:0:ffff:169.254.169.254",
  // "0000:0000:0000:0000:0000:ffff:169.254.169.254" and
  // "0:0::ffff:169.254.169.254" are all the SAME address as
  // "::ffff:169.254.169.254" but would silently fall through every check
  // below without this step. Route any genuine IPv6 literal through Node's
  // URL host-parser — the same canonicalizer `isBlockedUrl` already gets for
  // free via `new URL(url).hostname` — to fold it down to one canonical
  // form before matching. Guarded by `net.isIP(...) === 6` so this only ever
  // runs on strings Node itself already recognizes as valid IPv6 literals.
  if (net.isIP(normalized) === 6) {
    // Reject any zone-ID-suffixed IPv6 literal outright, before even
    // attempting canonicalization. net.isIP() (and therefore
    // net.connect()/tls.connect()) accepts zone IDs — e.g.
    // "::ffff:127.0.0.1%lo", "::ffff:169.254.169.254%eth0", or a plain
    // numeric zone index like "%1"/"%0" — but WHATWG URL does not, so the
    // `new URL()` canonicalization below would throw for every one of
    // these. There is no legitimate reason an admin-configured SMTP/SFTP
    // destination host needs a link-local zone identifier, so this is a
    // hard block rather than a fall-through.
    if (normalized.includes("%")) return true;
    try {
      normalized = new URL(`http://[${normalized}]/`).hostname.replace(/^\[|\]$/g, "");
    } catch {
      // A confirmed IPv6 literal (net.isIP() === 6) that URL's
      // canonicalizer could not parse for some other reason. FAIL CLOSED —
      // block it — rather than silently falling through to match the
      // un-canonicalized original string against the strictly end-anchored
      // ("$") regexes below, which would never match a non-canonical
      // spelling and would let a confirmed IP literal through unblocked.
      return true;
    }
  } else if (net.isIP(normalized) !== 4) {
    // --- Canonicalize obfuscated IPv4 literals -----------------------------
    // Same class of problem, one level down. Only strings net.isIP() does
    // NOT already recognize as a clean IPv4 literal take this path, so
    // already-canonical addresses are untouched.
    const canonical = canonicalizeObfuscatedIpv4(normalized);
    if (canonical) normalized = canonical;
  }

  // IPv4 checks
  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (isPrivateIpv4Octets(a!, b!)) return true;
  }
  // IPv6 checks
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true;  // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local

  // IPv4-mapped IPv6 (RFC 4291 §2.5.5.2): ::ffff:a.b.c.d dotted form, or its
  // pure-hex form ::ffff:xxxx:xxxx where the two hextets encode the same
  // 32-bit IPv4 address. A private/loopback/link-local/metadata IPv4 address
  // wrapped in either form must be blocked exactly like the bare IPv4 form.
  const mappedDotted = normalized.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (mappedDotted) {
    const [, a, b] = mappedDotted.map(Number);
    if (isPrivateIpv4Octets(a!, b!)) return true;
  }
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    if (isPrivateIpv4Octets(a, b)) return true;
  }
  return false;
}

export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Block every non-http(s) scheme unconditionally (file://, gopher://,
    // ftp://, javascript:, data:, etc.). zod's `.url()` accepts any scheme,
    // and there is no legitimate use case for a non-http(s) target in any
    // environment.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    const host = parsed.hostname.toLowerCase();
    // Block explicit loopback
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
    // Block 0.0.0.0
    if (host === "0.0.0.0") return true;
    // Block metadata endpoints (cloud providers)
    if (host === "169.254.169.254" || host === "metadata.google.internal") return true;
    // Block private IPv4 ranges (string-based first check)
    if (isPrivateIp(host)) return true;
    // Additionally require https specifically (not just http) in production.
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return true;
    return false;
  } catch {
    return true; // malformed → block
  }
}

/**
 * Resolve hostname via DNS and check if ANY resolved address is private.
 * Defeats DNS rebinding where a hostname initially resolves to a public IP
 * but later resolves to 169.254.169.254 (metadata) or 127.0.0.1.
 * Must be called at BOTH registration AND use (delivery/probe) time.
 */
export async function isBlockedAfterResolve(url: string): Promise<boolean> {
  if (isBlockedUrl(url)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // If it's already an IP, the string check above handles it
    if (/^[\d.]+$/.test(host) || host.includes(":")) return false;
    // Resolve A and AAAA records
    const [ipv4s, ipv6s] = await Promise.allSettled([
      resolve4(host),
      resolve6(host),
    ]);
    const allIps: string[] = [];
    if (ipv4s.status === "fulfilled") allIps.push(...ipv4s.value);
    if (ipv6s.status === "fulfilled") allIps.push(...ipv6s.value);
    // If ANY resolved IP is private, block it
    return allIps.some(isPrivateIp);
  } catch {
    // DNS resolution failure — block by default (fail-closed)
    return true;
  }
}

/**
 * Raw-socket path guard (SMTP/SFTP): given a bare host (hostname or IP literal,
 * no scheme), return true if it maps to a private/loopback/link-local/metadata
 * address and must NOT be dialed. Resolves DNS for hostnames (fail-closed on
 * resolution failure). Use before opening a TCP/TLS socket.
 */
export async function isBlockedHost(host: string): Promise<boolean> {
  const h = String(host ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost") return true;
  if (h === "metadata.google.internal") return true;
  // Route ANY recognizable IP-literal spelling — canonical or non-canonical
  // IPv6, zone-ID-suffixed IPv6, or obfuscated (octal/decimal/hex/shorthand)
  // IPv4 such as "0x7f000001"/"0x7f.0.0.1" — through isPrivateIp()'s
  // deterministic literal-parsing path FIRST. Only input that is NOT
  // recognizable as any IP-literal form (a genuine hostname) falls through
  // to DNS resolution below.
  //
  // The previous predicate here (`/^[\d.]+$/.test(h) || h.includes(":")`)
  // missed hex-form IPv4 entirely (no digits-and-dots-only match, no
  // colon), so it fell through to the resolve4/resolve6 DNS branch instead
  // of the already-hardened isPrivateIp() path — a branch that behaves
  // differently from dns.lookup() (what net.connect()/tls.connect()
  // actually use to resolve the host at connect time).
  if (isRecognizableIpLiteral(h)) return isPrivateIp(h);
  try {
    const [ipv4s, ipv6s] = await Promise.allSettled([resolve4(h), resolve6(h)]);
    const allIps: string[] = [];
    if (ipv4s.status === "fulfilled") allIps.push(...ipv4s.value);
    if (ipv6s.status === "fulfilled") allIps.push(...ipv6s.value);
    if (allIps.length === 0) return true; // could not resolve → fail-closed
    return allIps.some(isPrivateIp);
  } catch {
    return true; // fail-closed
  }
}
