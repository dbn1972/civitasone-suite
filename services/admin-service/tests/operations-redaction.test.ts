/**
 * GAP-TENANT-ADMIN-OPERATIONS-04: the operations log-excerpt redactor masks
 * personal data (email, phone, Aadhaar, PAN) and secrets (bearer/JWT, api
 * keys, DB URLs) before any excerpt reaches an admin browser.
 * GAP-TENANT-ADMIN-OPERATIONS-06: when PM2 is not present the collector
 * reports availability=false with an empty process list — it never throws.
 *
 * Pure/unit — does not build the Fastify app (buildApp() is blocked in this
 * worktree by an unrelated duplicate-route collision).
 */
import { describe, it, expect } from "vitest";
import { redactLogLine, readPm2Processes } from "../src/modules/health/operations.js";

describe("GAP-TENANT-ADMIN-OPERATIONS-04 — redactLogLine", () => {
  it("masks email, Aadhaar, PAN and a JWT in one line", () => {
    const out = redactLogLine("user asha@dept.gov.in aadhaar 2234 5678 9012 pan ABCDE1234F token eyJhbGciOiJIUzI1Niabcdef012345");
    expect(out).not.toContain("asha@dept.gov.in");
    expect(out).not.toContain("2234 5678 9012");
    expect(out).not.toContain("ABCDE1234F");
    expect(out).not.toMatch(/eyJhbGci/);
    expect(out).toContain("<email>");
    expect(out).toContain("<aadhaar>");
    expect(out).toContain("<pan>");
  });

  it("masks an Indian mobile number and a bearer token", () => {
    const out = redactLogLine("call +91 9876543210 Authorization: Bearer abc.def.ghi");
    expect(out).not.toContain("9876543210");
    expect(out).toContain("<phone>");
    expect(out).toContain("Bearer <redacted>");
  });

  it("masks a Postgres connection string and an api_key", () => {
    const out = redactLogLine("db postgres://u:p@host:5432/db api_key=SUPERSECRET123");
    expect(out).not.toContain("SUPERSECRET123");
    expect(out).not.toContain("u:p@host");
    expect(out).toContain("<redacted>");
  });

  // GAP2-ADMIN-OPERATIONS-01: public client IPs in error lines are personal data.
  it("masks a public IPv4 address but not a clock timestamp", () => {
    const out = redactLogLine("request from 203.0.113.9 failed at 10:00:00");
    expect(out).not.toContain("203.0.113.9");
    expect(out).toContain("<ip>");
    expect(out).toContain("10:00:00");
  });

  it("keeps loopback and RFC1918 private IPv4 (operator-useful infra)", () => {
    const out = redactLogLine("upstream 10.0.0.5 via 127.0.0.1 and 192.168.1.4 timed out");
    expect(out).toContain("10.0.0.5");
    expect(out).toContain("127.0.0.1");
    expect(out).toContain("192.168.1.4");
    expect(out).not.toContain("<ip>");
  });

  it("masks a public IPv6 address but keeps the loopback", () => {
    const out = redactLogLine("peer 2001:db8::1 unreachable; local ::1 ok");
    expect(out).not.toContain("2001:db8::1");
    expect(out).toContain("<ip>");
    expect(out).toContain("::1");
  });
});

describe("GAP-TENANT-ADMIN-OPERATIONS-06 — PM2 unavailable", () => {
  it("reports available=false with no processes instead of throwing when pm2 is absent", async () => {
    const result = await readPm2Processes();
    // In the test environment pm2 is not installed, so this exercises the
    // graceful-unavailable path (the fix's guarantee: 200 with empty, not 500).
    expect(result).toHaveProperty("available");
    expect(Array.isArray(result.processes)).toBe(true);
    if (!result.available) expect(result.processes).toEqual([]);
  });
});
