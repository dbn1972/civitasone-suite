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
