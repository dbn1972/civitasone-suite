/**
 * CAP-091 — unit tests for the pure central-config domain: maker-checker +
 * approvable + versioning guards, and AES-256-GCM encryption round-trips.
 */
import { describe, it, expect } from "vitest";
import {
  ConfigError,
  assertApproverDistinct,
  assertPending,
  nextVersion,
  deriveKey,
  encryptValue,
  decryptValue,
  isEncryptedBlob,
  sealForStorage,
  displayValue,
  safeEqual,
} from "../src/modules/central-config/domain.js";

const KEY = deriveKey("a".repeat(64)); // 64-hex → 32 raw bytes

describe("maker-checker guard", () => {
  it("rejects an approver identical to the proposer", () => {
    try {
      assertApproverDistinct("user-1", "user-1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).status).toBe(409);
      expect((e as ConfigError).code).toBe("MAKER_CHECKER_VIOLATION");
    }
  });
  it("allows a distinct approver", () => {
    expect(() => assertApproverDistinct("user-1", "user-2")).not.toThrow();
  });
});

describe("assertPending", () => {
  it("passes for pending", () => expect(() => assertPending("pending")).not.toThrow());
  it.each(["approved", "rejected", "bogus"])("throws NOT_PENDING for %s", (status) => {
    try {
      assertPending(status);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).code).toBe("NOT_PENDING");
    }
  });
});

describe("nextVersion", () => {
  it("starts at 1 from null/undefined", () => {
    expect(nextVersion(null)).toBe(1);
    expect(nextVersion(undefined)).toBe(1);
  });
  it("increments monotonically", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(41)).toBe(42);
  });
});

describe("deriveKey", () => {
  it("accepts a 64-char hex key as raw 32 bytes", () => {
    expect(deriveKey("f".repeat(64)).length).toBe(32);
  });
  it("hashes a passphrase to 32 bytes", () => {
    expect(deriveKey("short-passphrase").length).toBe(32);
  });
});

describe("AES-256-GCM encryption", () => {
  it("round-trips a JSON value", () => {
    const secret = { apiKey: "sk-live-123", nested: [1, 2, 3] };
    const blob = encryptValue(secret, KEY);
    expect(isEncryptedBlob(blob)).toBe(true);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("sk-live-123");
    expect(decryptValue(blob, KEY)).toEqual(secret);
  });
  it("produces a distinct ciphertext each call (random IV)", () => {
    expect(encryptValue("x", KEY)).not.toBe(encryptValue("x", KEY));
  });
  it("fails to decrypt with the wrong key", () => {
    const blob = encryptValue("secret", KEY);
    expect(() => decryptValue(blob, deriveKey("b".repeat(64)))).toThrow(ConfigError);
  });
  it("rejects a tampered ciphertext (auth tag mismatch)", () => {
    const blob = encryptValue("secret", KEY);
    const parts = blob.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from("zzzz").toString("base64")}`;
    expect(() => decryptValue(tampered, KEY)).toThrow(ConfigError);
  });
  it("rejects a malformed blob", () => {
    expect(() => decryptValue("not-a-blob", KEY)).toThrow(ConfigError);
    expect(isEncryptedBlob("nope")).toBe(false);
  });
});

describe("sealForStorage", () => {
  it("stores a non-sensitive value in plaintext", () => {
    const r = sealForStorage({ a: 1 }, false, KEY);
    expect(r.encrypted).toBe(false);
    expect(r.stored).toEqual({ a: 1 });
  });
  it("encrypts a sensitive value when a key is configured", () => {
    const r = sealForStorage("topsecret", true, KEY);
    expect(r.encrypted).toBe(true);
    expect(isEncryptedBlob(r.stored)).toBe(true);
    expect(decryptValue(r.stored as string, KEY)).toBe("topsecret");
  });
  it("fail-closed: refuses to store a sensitive value with no key", () => {
    try {
      sealForStorage("topsecret", true, null);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).status).toBe(503);
      expect((e as ConfigError).code).toBe("ENCRYPTION_UNAVAILABLE");
    }
  });
});

describe("displayValue", () => {
  it("returns plaintext as-is", () => {
    expect(displayValue({ a: 1 }, false)).toEqual({ a: 1 });
  });
  it("masks encrypted values by default", () => {
    const blob = encryptValue("secret", KEY);
    expect(displayValue(blob, true)).toBe("***");
  });
  it("reveals encrypted values only when asked with a key", () => {
    const blob = encryptValue("secret", KEY);
    expect(displayValue(blob, true, { reveal: true, key: KEY })).toBe("secret");
  });
  it("still masks when reveal is asked but no key is available", () => {
    const blob = encryptValue("secret", KEY);
    expect(displayValue(blob, true, { reveal: true, key: null })).toBe("***");
  });
});

describe("safeEqual", () => {
  it("true for equal, false for different or different-length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
