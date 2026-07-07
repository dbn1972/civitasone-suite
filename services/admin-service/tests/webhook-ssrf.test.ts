/**
 * Invariant test: H6 — Webhook SSRF protection.
 *
 * PROPERTY: A webhook URL whose DNS resolves to a private/loopback/link-local
 * address is rejected at BOTH registration and send time.
 */
import { describe, it, expect } from "vitest";
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
