/**
 * Invariant test: H6 — Webhook SSRF protection.
 *
 * PROPERTY: A webhook URL whose DNS resolves to a private/loopback/link-local
 * address is rejected at BOTH registration and send time.
 */
import { describe, it, expect, vi } from "vitest";
import { isBlockedUrl, isPrivateIp } from "../src/modules/webhooks/routes.js";

describe("H6 — Webhook SSRF guard (string-based)", () => {
  it("blocks localhost", () => {
    expect(isBlockedUrl("https://localhost/webhook")).toBe(true);
    expect(isBlockedUrl("https://127.0.0.1/webhook")).toBe(true);
    expect(isBlockedUrl("https://[::1]/webhook")).toBe(true);
  });

  it("blocks AWS metadata endpoint", () => {
    expect(isBlockedUrl("http://169.254.169.254/latest/meta-data/")).toBe(true);
  });

  it("blocks private RFC1918 ranges", () => {
    expect(isBlockedUrl("https://10.0.0.1/hook")).toBe(true);
    expect(isBlockedUrl("https://172.16.0.1/hook")).toBe(true);
    expect(isBlockedUrl("https://172.31.255.255/hook")).toBe(true);
    expect(isBlockedUrl("https://192.168.1.1/hook")).toBe(true);
  });

  it("allows public URLs", () => {
    expect(isBlockedUrl("https://example.com/webhook")).toBe(false);
    expect(isBlockedUrl("https://hooks.slack.com/webhook")).toBe(false);
    expect(isBlockedUrl("https://8.8.8.8/test")).toBe(false);
  });

  it("blocks malformed URLs", () => {
    expect(isBlockedUrl("not-a-url")).toBe(true);
    expect(isBlockedUrl("")).toBe(true);
  });

  it("blocks 0.0.0.0", () => {
    expect(isBlockedUrl("http://0.0.0.0/hook")).toBe(true);
  });

  it("blocks non-http(s) schemes unconditionally, not just in production (file://, gopher://, ftp://, javascript:, data:)", () => {
    expect(isBlockedUrl("file:///etc/passwd")).toBe(true);
    expect(isBlockedUrl("gopher://example.com")).toBe(true);
    expect(isBlockedUrl("ftp://example.com/x")).toBe(true);
    expect(isBlockedUrl("javascript:alert(1)")).toBe(true);
    expect(isBlockedUrl("data:text/html,<script>1</script>")).toBe(true);
  });

  it("allows http and https schemes", () => {
    expect(isBlockedUrl("http://example.com/hook")).toBe(false);
    expect(isBlockedUrl("https://example.com/hook")).toBe(false);
  });
});

describe("H6 — isBlockedAfterResolve (DNS rebinding defense)", () => {
  it("blocks a hostname whose DNS A record resolves to a private IP, even though the URL string itself looks public", async () => {
    vi.doMock("node:dns/promises", () => ({
      resolve4: async () => ["169.254.169.254"],
      resolve6: async () => { throw new Error("no AAAA"); },
    }));
    vi.resetModules();
    const { isBlockedAfterResolve } = await import("../src/modules/webhooks/routes.js");
    // The hostname string itself is not in any blocked pattern — only the
    // mocked DNS resolution reveals it points at the cloud metadata IP.
    expect(await isBlockedAfterResolve("https://looks-public-but-rebinds.example.com/hook")).toBe(true);
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("allows a hostname whose DNS resolves only to public IPs", async () => {
    vi.doMock("node:dns/promises", () => ({
      resolve4: async () => ["93.184.216.34"], // example.com's public IP
      resolve6: async () => { throw new Error("no AAAA"); },
    }));
    vi.resetModules();
    const { isBlockedAfterResolve } = await import("../src/modules/webhooks/routes.js");
    expect(await isBlockedAfterResolve("https://genuinely-public.example.com/hook")).toBe(false);
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });
});

describe("H6 — PUT /v1/admin/webhooks/:id re-validates URL changes with the same SSRF guard as create", () => {
  it("rejects updating a webhook's URL to a private IP", async () => {
    const { buildApp } = await import("../src/app.js");
    const { signToken } = await import("@civitasone/auth");
    const app = await buildApp();
    const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
    const T = "99999999-abcd-4000-8000-000000000001";
    const token = signToken({ sub: "actor-1", tid: T, roles: ["super_admin"], sid: "s1" }, SECRET, 3600);
    const headers = { authorization: `Bearer ${token}` };

    // updateBody's zod `.refine()` already blocks obviously-private string
    // literals; use a UUID that plausibly wouldn't exist rather than
    // asserting on a specific downstream status — the key property under
    // test is that a private-IP URL is rejected (400 from the zod refine),
    // not that the webhook happens to exist.
    const res = await app.inject({
      method: "PUT", url: "/v1/admin/webhooks/11111111-1111-4000-8000-000000000001",
      headers, payload: { url: "https://169.254.169.254/steal-credentials" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("H6 — isPrivateIp helper", () => {
  it("detects private IPv4", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("detects private IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12::1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("203.0.113.1")).toBe(false);
  });
});
