/**
 * Identity Service — Comprehensive Domain Tests.
 *
 * Tests API key lifecycle (generation, scopes, transitions, usability),
 * RBAC authority model, and secret hashing.
 *
 * Source: modules/apikeys/domain.ts, modules/rbac/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  generateSecret, sha256Hex, isValidScope, assertValidScopes,
  scopesSatisfy, assertScope, canTransition, assertTransition, isUsable,
  DomainError, type ApiKeyStatus,
} from "../src/modules/apikeys/domain.js";
import {
  hasUnconditionalAuthority, isReservedKey, isValidKeyFormat,
  assertKeyAllowed, assertCanConfer, DomainError as RbacDomainError,
} from "../src/modules/rbac/domain.js";

// ═══ API Key — Secret Generation ═══

describe("generateSecret — cryptographic key generation", () => {
  it("produces keyPrefix starting with ak_live_", () => {
    const { keyPrefix } = generateSecret();
    expect(keyPrefix).toMatch(/^ak_live_[0-9a-f]{6}$/);
  });
  it("fullKey = keyPrefix.secret", () => {
    const { keyPrefix, secret, fullKey } = generateSecret();
    expect(fullKey).toBe(`${keyPrefix}.${secret}`);
  });
  it("secretHash is SHA-256 hex of fullKey", () => {
    const { fullKey, secretHash } = generateSecret();
    expect(secretHash).toBe(sha256Hex(fullKey));
  });
  it("two calls produce different keys", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a.fullKey).not.toBe(b.fullKey);
    expect(a.secretHash).not.toBe(b.secretHash);
  });
  it("secretHash is 64 hex chars (SHA-256)", () => {
    expect(generateSecret().secretHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sha256Hex", () => {
  it("deterministic", () => expect(sha256Hex("test")).toBe(sha256Hex("test")));
  it("produces 64 chars", () => expect(sha256Hex("hello")).toHaveLength(64));
  it("different input = different hash", () => expect(sha256Hex("a")).not.toBe(sha256Hex("b")));
});

// ═══ API Key — Scope Validation ═══

describe("isValidScope — resource:action format", () => {
  it("accepts users:read", () => expect(isValidScope("users:read")).toBe(true));
  it("accepts users:*", () => expect(isValidScope("users:*")).toBe(true));
  it("accepts *:read", () => expect(isValidScope("*:read")).toBe(true));
  it("accepts *:*", () => expect(isValidScope("*:*")).toBe(true));
  it("rejects bare word", () => expect(isValidScope("read")).toBe(false));
  it("rejects empty", () => expect(isValidScope("")).toBe(false));
  it("rejects uppercase", () => expect(isValidScope("Users:Read")).toBe(false));
  it("rejects spaces", () => expect(isValidScope("users: read")).toBe(false));
});

describe("assertValidScopes", () => {
  it("passes for valid scopes", () => expect(() => assertValidScopes(["users:read", "billing:*"])).not.toThrow());
  it("throws INVALID_SCOPE for bad format", () => expect(() => assertValidScopes(["users:read", "BAD"])).toThrow(DomainError));
});

describe("scopesSatisfy — wildcard matching", () => {
  it("exact match", () => expect(scopesSatisfy(["users:read"], "users:read")).toBe(true));
  it("* action matches any action", () => expect(scopesSatisfy(["users:*"], "users:write")).toBe(true));
  it("* resource matches any resource", () => expect(scopesSatisfy(["*:read"], "billing:read")).toBe(true));
  it("*:* matches everything", () => expect(scopesSatisfy(["*:*"], "anything:here")).toBe(true));
  it("no match returns false", () => expect(scopesSatisfy(["users:read"], "billing:write")).toBe(false));
  it("partial resource mismatch", () => expect(scopesSatisfy(["users:read"], "user:read")).toBe(false));
});

describe("assertScope", () => {
  it("passes when satisfied", () => expect(() => assertScope(["users:*"], "users:read")).not.toThrow());
  it("throws OUT_OF_SCOPE", () => expect(() => assertScope(["users:read"], "billing:write")).toThrow(DomainError));
});

// ═══ API Key — Lifecycle ═══

describe("canTransition — API key status machine", () => {
  it("active → rotated", () => expect(canTransition("active", "rotated")).toBe(true));
  it("active → revoked", () => expect(canTransition("active", "revoked")).toBe(true));
  it("rotated → revoked", () => expect(canTransition("rotated", "revoked")).toBe(true));
  it("revoked is terminal", () => expect(canTransition("revoked", "active")).toBe(false));
  it("rotated → active is illegal", () => expect(canTransition("rotated", "active")).toBe(false));
});

describe("assertTransition", () => {
  it("throws INVALID_TRANSITION", () => expect(() => assertTransition("revoked", "active")).toThrow(DomainError));
  it("same-to-same is idempotent no-op", () => expect(() => assertTransition("active", "active")).not.toThrow());
});

describe("isUsable — active + not expired", () => {
  it("true when active, no expiry", () => expect(isUsable("active", null)).toBe(true));
  it("true when active, future expiry", () => expect(isUsable("active", new Date("2099-01-01"))).toBe(true));
  it("false when active but expired", () => expect(isUsable("active", new Date("2020-01-01"))).toBe(false));
  it("false when rotated", () => expect(isUsable("rotated", null)).toBe(false));
  it("false when revoked", () => expect(isUsable("revoked", null)).toBe(false));
});

// ═══ RBAC Authority (already tested but included for comprehensive suite) ═══

describe("RBAC — authority + escalation (comprehensive)", () => {
  it("super_admin has unconditional authority", () => expect(hasUnconditionalAuthority(["super_admin"])).toBe(true));
  it("tenant_admin does NOT", () => expect(hasUnconditionalAuthority(["tenant_admin"])).toBe(false));
  it("system is a reserved key", () => expect(isReservedKey("system")).toBe(true));
  it("hr.read is NOT reserved", () => expect(isReservedKey("hr.read")).toBe(false));
  it("valid key format: dot.colon.namespaced", () => expect(isValidKeyFormat("hr.employee.read")).toBe(true));
  it("invalid format: uppercase", () => expect(isValidKeyFormat("HR.Read")).toBe(false));
  it("assertKeyAllowed blocks reserved key for non-super", () => {
    expect(() => assertKeyAllowed(["tenant_admin"], ["super_admin"])).toThrow(RbacDomainError);
  });
  it("assertCanConfer blocks missing perms", () => {
    expect(() => assertCanConfer(["hr_admin"], new Set(["hr.read"]), ["payroll.run"])).toThrow(RbacDomainError);
  });
});
