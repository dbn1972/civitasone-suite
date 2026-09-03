/**
 * SECURITY FIX — SSRF guard bypassable via IPv6-mapped addresses.
 *
 * PROPERTY: `isPrivateIp` (and therefore every function built on it —
 * `isBlockedUrl`, `isBlockedAfterResolve`, `isBlockedHost`) must recognize
 * private/loopback/link-local/metadata addresses regardless of how they are
 * spelled: bare IPv4, bracketed/bare IPv6, and — the bug fixed here —
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d` and its hex form `::ffff:xxxx:xxxx`),
 * which previously bypassed the guard entirely because `isPrivateIp` had no
 * handling for that form at all.
 */
import { describe, it, expect } from "vitest";
import { isPrivateIp, isBlockedUrl, isBlockedHost } from "../src/shared/ssrf-guard.js";

describe("SSRF guard — IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:xxxx:xxxx)", () => {
  it("isPrivateIp blocks IPv4-mapped forms of private/loopback/link-local/metadata addresses", () => {
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);       // loopback
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);        // RFC1918
    expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);     // RFC1918
    expect(isPrivateIp("::ffff:172.16.0.1")).toBe(true);      // RFC1918
    expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true);       // hex form of 169.254.169.254
  });

  it("isPrivateIp still allows an IPv4-mapped PUBLIC address", () => {
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("SSRF guard — bracketed IPv6 forms (URL.hostname keeps brackets)", () => {
  it("isPrivateIp blocks bracketed link-local / unique-local / unspecified", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("[fe80::1]")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("[fc00::1]")).toBe(true);
    expect(isPrivateIp("fd12::1")).toBe(true);
    expect(isPrivateIp("[fd12::1]")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
    expect(isPrivateIp("[::]")).toBe(true);
  });

  it("isPrivateIp still allows legitimate global IPv6 addresses", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false); // Cloudflare public DNS
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false); // Google public DNS
  });
});

describe("SSRF guard — isBlockedUrl: the exact bypass payloads reported", () => {
  it("blocks every reported IPv6-literal bypass payload", () => {
    expect(isBlockedUrl("http://[::ffff:169.254.169.254]/")).toBe(true);
    expect(isBlockedUrl("http://[::ffff:127.0.0.1]/")).toBe(true);
    expect(isBlockedUrl("http://[fe80::1]/")).toBe(true);
    expect(isBlockedUrl("http://[fc00::1]/")).toBe(true);
    expect(isBlockedUrl("http://[::]/")).toBe(true);
  });

  it("still allows a legitimate global IPv6 literal URL", () => {
    expect(isBlockedUrl("http://[2606:4700:4700::1111]/")).toBe(false);
  });

  it("does not regress already-caught IPv4 obfuscation tricks", () => {
    expect(isBlockedUrl("http://0177.0.0.1/")).toBe(true);  // octal loopback
    expect(isBlockedUrl("http://2130706433/")).toBe(true);  // decimal loopback
    expect(isBlockedUrl("http://127.1/")).toBe(true);       // shorthand loopback
    expect(isBlockedUrl("https://example.com/webhook")).toBe(false);
    expect(isBlockedUrl("https://8.8.8.8/test")).toBe(false);
  });
});

describe("SSRF guard — isBlockedHost: the bare (non-URL) tcpGreeting-path payloads reported", () => {
  it("blocks bare IPv4-mapped IPv6 forms with no scheme/brackets", async () => {
    expect(await isBlockedHost("::ffff:169.254.169.254")).toBe(true);
    expect(await isBlockedHost("::ffff:127.0.0.1")).toBe(true);
  });

  it("still allows a bare legitimate public IP/hostname literal", async () => {
    expect(await isBlockedHost("8.8.8.8")).toBe(false);
  });
});

describe("SSRF guard — isBlockedHost: non-canonical IPv6 spellings (raw-string path, PR #923 follow-up)", () => {
  // The independent reviewer's confirmed bypass: isBlockedHost() receives the
  // RAW admin-configured SMTP/SFTP host with no URL parsing, so it never got
  // the free canonicalization isBlockedUrl() gets from `new URL()`. Node's
  // own net.isIP() (used by net.connect/tls.connect under the hood) accepts
  // every one of these non-canonical spellings as the SAME IPv6-mapped
  // 169.254.169.254 (cloud metadata) literal — so the old regex-only
  // matching in isPrivateIp(), which only recognized the single
  // maximally-compressed "::ffff:a9fe:a9fe" spelling, silently let all three
  // through to tcpGreeting()'s net.connect()/tls.connect() call.
  it("blocks fully-expanded and alternately-compressed spellings of ::ffff:169.254.169.254", async () => {
    expect(await isBlockedHost("0:0:0:0:0:ffff:169.254.169.254")).toBe(true);
    expect(await isBlockedHost("0000:0000:0000:0000:0000:ffff:169.254.169.254")).toBe(true);
    expect(await isBlockedHost("0:0::ffff:169.254.169.254")).toBe(true);
  });

  it("still blocks the already-canonical spelling (regression check)", async () => {
    expect(await isBlockedHost("::ffff:169.254.169.254")).toBe(true);
    expect(await isBlockedHost("::ffff:a9fe:a9fe")).toBe(true);
  });

  it("still allows a normal hostname and a normal public IPv4 address", async () => {
    expect(await isBlockedHost("smtp.gmail.com")).toBe(false);
    expect(await isBlockedHost("8.8.8.8")).toBe(false);
  });

  it("does not crash on malformed/garbage input and fails closed where ambiguous", async () => {
    await expect(isBlockedHost("")).resolves.toBe(true);
    await expect(isBlockedHost("   ")).resolves.toBe(true);
    // Contains colons but is not any recognizable IP-literal spelling
    // (net.isIP === 0, no "%" zone suffix, not obfuscated-IPv4-shaped), so
    // the PR #923 round-3 routing fix sends it to the DNS-resolve branch
    // instead of assuming it's "just not private" — resolve4/resolve6 both
    // fail for this garbage string, and the resolve branch fails CLOSED
    // (allIps.length === 0 → blocked). This is a deliberate behavior change
    // from the previous round (which returned false here via the
    // then-narrower `/^[\d.]+$/.test(h) || h.includes(":")` routing
    // predicate reaching isPrivateIp() directly) — stricter is safe here,
    // since this input was never a legitimate host either way.
    await expect(isBlockedHost(":::::not-an-ip:::::")).resolves.toBe(true);
    await expect(isBlockedHost("not a valid host at all !!")).resolves.toBe(true);
    // @ts-expect-error — exercising the runtime null/undefined guard
    await expect(isBlockedHost(null)).resolves.toBe(true);
    // @ts-expect-error — exercising the runtime null/undefined guard
    await expect(isBlockedHost(undefined)).resolves.toBe(true);
  });
});

describe("SSRF guard — isBlockedHost: obfuscated IPv4 literals (raw-string path, PR #923 follow-up)", () => {
  // Separately noted by the reviewer (not a merge blocker, but investigated
  // here since it's the same code path): octal/decimal/hex/shorthand IPv4
  // obfuscation was already proven safe through isBlockedUrl() (which gets
  // WHATWG URL's IPv4-parser canonicalization for free), but was UNPROVEN —
  // and, on investigation, was in fact ALSO exploitable — through
  // isBlockedHost()'s raw-string path. Confirmed on this host that
  // dns.lookup() (what net.connect()'s DNS-lookup path actually uses)
  // resolves every one of these to 127.0.0.1, while the pre-fix
  // isBlockedHost()/isPrivateIp() did not recognize them as private at all.
  it("blocks octal, decimal, hex, and shorthand loopback spellings", async () => {
    expect(await isBlockedHost("0177.0.0.1")).toBe(true);       // octal loopback
    expect(await isBlockedHost("2130706433")).toBe(true);       // decimal (32-bit) loopback
    expect(await isBlockedHost("017700000001")).toBe(true);     // decimal-looking octal loopback
    expect(await isBlockedHost("127.1")).toBe(true);            // shorthand loopback
    expect(await isBlockedHost("0x7f.0.0.1")).toBe(true);       // hex loopback
    expect(await isBlockedHost("0x7f000001")).toBe(true);       // hex (32-bit) loopback
  });

  it("blocks octal/decimal/hex spellings of the cloud metadata address too", async () => {
    expect(await isBlockedHost("0251.0376.0251.0376")).toBe(true); // octal 169.254.169.254
    expect(await isBlockedHost("2852039166")).toBe(true);          // decimal 169.254.169.254
  });

  it("still allows a normal, already-canonical public IPv4 literal", async () => {
    expect(await isBlockedHost("8.8.8.8")).toBe(false);
    expect(await isBlockedHost("1.2.3.4")).toBe(false);
  });
});

describe("SSRF guard — Finding 1 (CRITICAL, PR #923 round 3): IPv6 zone-ID bypass", () => {
  // The independent reviewer's confirmed, real-socket-level bypass:
  // net.isIP() (and therefore net.connect()/tls.connect(), which use the
  // same parser) accepts a "%zone" suffix on an IPv6 literal, but WHATWG
  // URL does not — `new URL("http://[" + h + "]/")` THROWS for these. The
  // pre-fix code silently fell back to matching the un-canonicalized,
  // zone-suffixed string against strictly end-anchored ("$") regexes, which
  // can never match because of the trailing "%zone" content — so the
  // address sailed through as "not private". Fixed two ways: (1) an
  // explicit "%" check that rejects any zone-ID-suffixed IPv6 literal
  // outright, and (2) fail-CLOSED (not fail-open) on any canonicalization
  // exception for a confirmed IPv6 literal, as defense in depth.
  it("isPrivateIp blocks zone-ID-suffixed loopback and metadata literals directly", () => {
    expect(isPrivateIp("::ffff:127.0.0.1%lo")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254%eth0")).toBe(true);
    expect(isPrivateIp("fe80::1%eth0")).toBe(true);
  });

  it("isBlockedHost blocks every zone-ID payload the reviewer proved exploitable at the socket layer", async () => {
    // Interface-name zone IDs.
    expect(await isBlockedHost("::ffff:169.254.169.254%eth0")).toBe(true);
    expect(await isBlockedHost("::ffff:169.254.169.254%ens5")).toBe(true);
    expect(await isBlockedHost("::ffff:169.254.169.254%en0")).toBe(true);
    expect(await isBlockedHost("::ffff:127.0.0.1%lo")).toBe(true);
    // Plain numeric zone indices — no per-host recon needed, work
    // everywhere.
    expect(await isBlockedHost("::ffff:127.0.0.1%1")).toBe(true);
    expect(await isBlockedHost("::ffff:127.0.0.1%2")).toBe(true);
    expect(await isBlockedHost("::ffff:127.0.0.1%0")).toBe(true);
    expect(await isBlockedHost("fe80::1%1")).toBe(true);
    expect(await isBlockedHost("fe80::1%0")).toBe(true);
  });

  it("does not regress a zone-free legitimate global IPv6 literal", async () => {
    expect(await isBlockedHost("2606:4700:4700::1111")).toBe(false);
  });
});

describe("SSRF guard — Finding 2 (MEDIUM, PR #923 round 3): hex-form IPv4 routing gap", () => {
  // isBlockedHost()'s routing predicate previously only sent digit-dot-only
  // (`/^[\d.]+$/`) or colon-containing strings through isPrivateIp()'s
  // deterministic literal-parsing path; hex-form IPv4 ("0x7f000001",
  // "0x7f.0.0.1" — contains hex letters/"x", no colon) fell through to a
  // resolve4/resolve6 DNS-resolve branch instead, which — unlike
  // dns.lookup() (what net.connect()/tls.connect() actually use) — behaves
  // differently across DNS environments and only happened to fail closed on
  // the original test host by accident (ENOTFOUND), masking the gap. Fixed
  // by routing ANY recognizable IP-literal spelling (including hex-form
  // IPv4) through isPrivateIp() first, and only falling through to DNS
  // resolution for input that isn't IP-literal-shaped at all.
  it("blocks hex-form IPv4 loopback via the isPrivateIp path, not as an accident of DNS failure", async () => {
    expect(await isBlockedHost("0x7f000001")).toBe(true); // 32-bit hex loopback
    expect(await isBlockedHost("0x7f.0.0.1")).toBe(true); // per-octet hex loopback
  });

  it("blocks hex-form IPv4 metadata address in both 32-bit and per-octet spellings", async () => {
    expect(await isBlockedHost("0xa9fea9fe")).toBe(true);         // 32-bit hex 169.254.169.254
    expect(await isBlockedHost("0xa9.0xfe.0xa9.0xfe")).toBe(true); // per-octet hex 169.254.169.254
  });

  it("still allows a normal hostname (proves the routing widening didn't start swallowing real hostnames)", async () => {
    expect(await isBlockedHost("smtp.gmail.com")).toBe(false);
    expect(await isBlockedHost("example.com")).toBe(false);
  });
});

describe("SSRF guard — defensive extras: other encoding tricks in the same family", () => {
  // Not independently reported, but the same class of bug (a case, padding,
  // or grouping variant net.isIP()/getaddrinfo accepts but our matching
  // didn't) — checked defensively alongside the two confirmed findings.
  it("blocks uppercase-hex IPv6 spellings (normalized lowercases before matching)", () => {
    expect(isPrivateIp("::FFFF:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::FFFF:A9FE:A9FE")).toBe(true);
    expect(isPrivateIp("FE80::1")).toBe(true);
  });

  it("blocks an IPv4-mapped hex form combined with a zone ID", async () => {
    expect(await isBlockedHost("::ffff:a9fe:a9fe%eth0")).toBe(true);
  });

  it("blocks uppercase 0X-prefixed hex IPv4", async () => {
    expect(await isBlockedHost("0X7f000001")).toBe(true);
  });

  it("blocks unusual leading-zero IPv4 octet grouping", async () => {
    expect(await isBlockedHost("127.000.000.1")).toBe(true);
  });
});

describe("SSRF guard — Finding (round-3 review): redundant/harmful bare-\"%\" special-case removed", () => {
  // isRecognizableIpLiteral() previously had `if (normalized.includes("%"))
  // return true;` in addition to the `net.isIP(normalized) !== 0` check
  // above it. That extra line was redundant (every genuine zone-ID IPv6
  // literal is already caught by net.isIP()) AND harmful: it made
  // isRecognizableIpLiteral() return true for ANY string merely containing
  // a stray "%" — including malformed non-IP garbage like
  // "169.254.169.254%eth0" (not a valid IP literal, just the metadata IP
  // with junk appended) or "0x7f000001%lo". Those then got routed to
  // isPrivateIp(), which doesn't recognize them as any known pattern (the
  // trailing junk breaks every regex) and defaults to `false` — so
  // isBlockedHost() incorrectly returned false (NOT BLOCKED) for these,
  // instead of falling through to the DNS-resolve fallback, which fails
  // closed. Removing the redundant line lets this malformed input fall
  // through to canonicalizeObfuscatedIpv4() (returns null — not
  // obfuscated-IPv4-shaped due to the trailing junk) and then to the
  // DNS-resolve branch, which fails closed since resolve4/resolve6 both
  // reject this input.
  it("fails closed for malformed IP-plus-stray-%-junk strings that were previously let through", async () => {
    expect(await isBlockedHost("169.254.169.254%eth0")).toBe(true);
    expect(await isBlockedHost("0x7f000001%lo")).toBe(true);
  });
});
