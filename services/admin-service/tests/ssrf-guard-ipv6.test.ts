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
    // Contains a colon, so it takes the synchronous IP-literal branch rather
    // than the fail-closed DNS-resolve branch; it isn't a valid IPv6 literal
    // (net.isIP === 0) so isPrivateIp() sensibly returns false. This is not
    // an SSRF exposure: net.connect()/tls.connect() would themselves reject
    // this string as neither a valid IP nor a resolvable hostname before any
    // socket could be opened. Documented here as the deliberate, sensible,
    // non-crashing behavior for this shape of input, per this function's
    // callers (tcpGreeting() / sftp-ingest.ts), which only branch on the
    // boolean and never inspect the reason.
    await expect(isBlockedHost(":::::not-an-ip:::::")).resolves.toBe(false);
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
