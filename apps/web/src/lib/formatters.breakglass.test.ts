import { describe, it, expect } from "vitest";
import { formatDuration, formatDateTimeIST, endpointOrigin } from "./formatters";

describe("formatDuration (GAP-TENANT-ADMIN-BREAKGLASS-03)", () => {
  it("formats a 2h 15m span", () => {
    expect(formatDuration("2026-01-01T10:00:00Z", "2026-01-01T12:15:00Z")).toBe("2h 15m");
  });

  it("formats minutes-only", () => {
    expect(formatDuration("2026-01-01T10:00:00Z", "2026-01-01T10:45:00Z")).toBe("45m");
  });

  it("formats multi-day spans", () => {
    expect(formatDuration("2026-01-01T10:00:00Z", "2026-01-03T13:00:00Z")).toBe("2d 3h");
  });

  it("returns 0m for a non-positive span", () => {
    expect(formatDuration("2026-01-01T10:00:00Z", "2026-01-01T10:00:10Z")).toBe("0m");
  });

  it("runs an open span to a provided 'now'", () => {
    expect(formatDuration("2026-01-01T10:00:00Z", undefined, new Date("2026-01-01T11:30:00Z"))).toBe("1h 30m");
  });

  it("returns — for a missing/invalid start", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration("not-a-date", "2026-01-01T10:00:00Z")).toBe("—");
  });
});

describe("formatDateTimeIST (GAP-TENANT-ADMIN-IDP-03)", () => {
  it("renders an IST-labelled date-time", () => {
    const out = formatDateTimeIST("2026-09-29T00:00:00Z");
    expect(out).toMatch(/29 Sep 2026/);
    expect(out).toMatch(/IST$/);
  });

  it("returns — for null/invalid", () => {
    expect(formatDateTimeIST(null)).toBe("—");
    expect(formatDateTimeIST("garbage")).toBe("—");
  });
});

describe("endpointOrigin (GAP-TENANT-ADMIN-IDP-03)", () => {
  it("keeps only scheme+host, dropping userinfo/path/query", () => {
    expect(endpointOrigin("https://user:pw@idp.example/realms/x?a=b")).toBe("https://idp.example");
  });

  it("handles an ldaps host:port with a path", () => {
    expect(endpointOrigin("ldaps://ldap.example:636/dc=x")).toBe("ldaps://ldap.example:636");
  });

  it("returns — for empty/invalid", () => {
    expect(endpointOrigin("")).toBe("—");
    expect(endpointOrigin(null)).toBe("—");
  });
});
