import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSessionRoles, getSessionTenantId } from "./roleGuard";

// The cookies() mock returns a get function we can control
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

// Mock redirect to track calls
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

describe("getSessionRoles", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("returns empty array when no token cookie", () => {
    mockGet.mockReturnValue(undefined);
    expect(getSessionRoles()).toEqual([]);
  });

  it("returns empty array when token has no roles field", () => {
    mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1" }) });
    expect(getSessionRoles()).toEqual([]);
  });

  it("returns roles from JWT payload", () => {
    mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles: ["finance", "admin"] }) });
    expect(getSessionRoles()).toEqual(["finance", "admin"]);
  });

  it("handles malformed token gracefully", () => {
    mockGet.mockReturnValue({ value: "not-a-jwt" });
    expect(getSessionRoles()).toEqual([]);
  });

  it("handles token with invalid base64 gracefully", () => {
    mockGet.mockReturnValue({ value: "header.!!!invalid-base64.sig" });
    expect(getSessionRoles()).toEqual([]);
  });
});

describe("getSessionTenantId", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("returns null when no token cookie", () => {
    mockGet.mockReturnValue(undefined);
    expect(getSessionTenantId()).toBeNull();
  });

  it("returns tenantId from JWT payload", () => {
    mockGet.mockReturnValue({ value: makeJwt({ tid: "tenant-uuid-123" }) });
    expect(getSessionTenantId()).toBe("tenant-uuid-123");
  });

  it("returns null when tid is empty string", () => {
    mockGet.mockReturnValue({ value: makeJwt({ tid: "" }) });
    expect(getSessionTenantId()).toBeNull();
  });

  it("returns null when tid is missing", () => {
    mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1" }) });
    expect(getSessionTenantId()).toBeNull();
  });
});
