import { describe, it, expect } from "vitest";
import {
  generateSecret, sha256Hex, isValidScope, assertValidScopes, scopesSatisfy,
  assertScope, canTransition, assertTransition, isUsable, DomainError,
} from "../src/modules/apikeys/domain.js";

describe("api-key domain — secret generation + hashing", () => {
  it("generates a prefixed full key whose hash matches sha256(fullKey)", () => {
    const { keyPrefix, secret, fullKey, secretHash } = generateSecret();
    expect(keyPrefix.startsWith("ak_live_")).toBe(true);
    expect(fullKey).toBe(`${keyPrefix}.${secret}`);
    expect(secretHash).toBe(sha256Hex(fullKey));
    expect(secretHash).toHaveLength(64);
  });

  it("never repeats a secret across calls", () => {
    const a = generateSecret(), b = generateSecret();
    expect(a.fullKey).not.toBe(b.fullKey);
    expect(a.secretHash).not.toBe(b.secretHash);
  });
});

describe("api-key domain — scope model + enforcement", () => {
  it("validates resource:action tokens incl. wildcards", () => {
    for (const s of ["users:read", "users:*", "*:read", "*:*", "rbac:write"]) expect(isValidScope(s)).toBe(true);
    for (const s of ["users", "Users:read", "users:READ", "users read", ":read", "users:"]) expect(isValidScope(s)).toBe(false);
  });

  it("rejects invalid scope sets", () => {
    expect(() => assertValidScopes(["users:read"])).not.toThrow();
    expect(() => assertValidScopes(["bad scope"])).toThrowError(/not a valid/);
  });

  it("wildcards satisfy concrete required scopes", () => {
    expect(scopesSatisfy(["users:*"], "users:read")).toBe(true);
    expect(scopesSatisfy(["*:read"], "rbac:read")).toBe(true);
    expect(scopesSatisfy(["*:*"], "anything:write")).toBe(true);
    expect(scopesSatisfy(["users:read"], "users:write")).toBe(false);
    expect(scopesSatisfy(["users:read"], "rbac:read")).toBe(false);
  });

  it("assertScope throws OUT_OF_SCOPE (403 semantics) when lacking scope", () => {
    expect(() => assertScope(["users:read"], "users:read")).not.toThrow();
    try {
      assertScope(["users:read"], "rbac:write");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("OUT_OF_SCOPE");
    }
  });
});

describe("api-key domain — lifecycle guards", () => {
  it("active → rotated|revoked allowed; revoked is terminal", () => {
    expect(canTransition("active", "rotated")).toBe(true);
    expect(canTransition("active", "revoked")).toBe(true);
    expect(canTransition("rotated", "revoked")).toBe(true);
    expect(canTransition("revoked", "active")).toBe(false);
    expect(() => assertTransition("revoked", "active")).toThrow();
    expect(() => assertTransition("revoked", "revoked")).not.toThrow(); // idempotent no-op
  });

  it("isUsable false for non-active or expired keys", () => {
    expect(isUsable("active", null)).toBe(true);
    expect(isUsable("revoked", null)).toBe(false);
    expect(isUsable("active", new Date(Date.now() - 1000))).toBe(false);
    expect(isUsable("active", new Date(Date.now() + 60_000))).toBe(true);
  });
});
