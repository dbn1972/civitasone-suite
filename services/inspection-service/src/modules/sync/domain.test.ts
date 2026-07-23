/**
 * Unit tests for sync domain logic.
 *
 * _Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.7, 6.8_
 */
import { describe, it, expect } from "vitest";
import {
  deterministicSerialize,
  resolveConflict,
  validateSequenceNumber,
  computeSha256,
  verifyIntegrity,
  DomainError,
} from "./domain.js";

describe("deterministicSerialize", () => {
  it("produces identical output regardless of key insertion order", () => {
    const obj1 = { b: 2, a: 1, c: 3 };
    const obj2 = { a: 1, c: 3, b: 2 };
    expect(deterministicSerialize(obj1)).toBe(deterministicSerialize(obj2));
  });

  it("sorts keys lexicographically", () => {
    const result = deterministicSerialize({ zebra: 1, alpha: 2, mango: 3 });
    expect(result).toBe('{"alpha":2,"mango":3,"zebra":1}');
  });

  it("handles nested objects with sorted keys at every level", () => {
    const obj = { z: { b: 2, a: 1 }, a: { d: 4, c: 3 } };
    const result = deterministicSerialize(obj);
    expect(result).toBe('{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}');
  });

  it("preserves arrays without reordering", () => {
    const obj = { items: [3, 1, 2], name: "test" };
    const result = deterministicSerialize(obj);
    expect(result).toBe('{"items":[3,1,2],"name":"test"}');
  });

  it("handles arrays of objects with sorted keys", () => {
    const obj = { list: [{ z: 1, a: 2 }, { y: 3, b: 4 }] };
    const result = deterministicSerialize(obj);
    expect(result).toBe('{"list":[{"a":2,"z":1},{"b":4,"y":3}]}');
  });

  it("round-trip property: serialize → parse → serialize produces identical output", () => {
    const original = { nested: { foo: "bar", baz: [1, 2, { z: 3, a: 4 }] }, top: true };
    const serialized = deterministicSerialize(original);
    const reserialized = deterministicSerialize(JSON.parse(serialized));
    expect(reserialized).toBe(serialized);
  });

  it("handles null values", () => {
    const result = deterministicSerialize({ b: null, a: 1 });
    expect(result).toBe('{"a":1,"b":null}');
  });

  it("handles empty objects", () => {
    expect(deterministicSerialize({})).toBe("{}");
  });

  it("handles primitive values", () => {
    expect(deterministicSerialize(42)).toBe("42");
    expect(deterministicSerialize("hello")).toBe('"hello"');
    expect(deterministicSerialize(true)).toBe("true");
    expect(deterministicSerialize(null)).toBe("null");
  });

  it("handles deeply nested structures", () => {
    const obj = { c: { b: { a: { z: 1, y: 2 } } } };
    const result = deterministicSerialize(obj);
    expect(result).toBe('{"c":{"b":{"a":{"y":2,"z":1}}}}');
  });
});

describe("resolveConflict", () => {
  it("accepts incoming when device timestamp is later", () => {
    const result = resolveConflict(
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:01:00Z" },
      { deviceTimestamp: "2024-01-01T11:00:00Z", serverTimestamp: "2024-01-01T11:01:00Z" },
    );
    expect(result).toBe("accept_incoming");
  });

  it("keeps existing when device timestamp is earlier", () => {
    const result = resolveConflict(
      { deviceTimestamp: "2024-01-01T11:00:00Z", serverTimestamp: "2024-01-01T11:01:00Z" },
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:01:00Z" },
    );
    expect(result).toBe("keep_existing");
  });

  it("uses server timestamp as tiebreaker when device timestamps are equal — incoming wins if server later", () => {
    const result = resolveConflict(
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:01:00Z" },
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:02:00Z" },
    );
    expect(result).toBe("accept_incoming");
  });

  it("uses server timestamp as tiebreaker when device timestamps are equal — existing wins if server earlier", () => {
    const result = resolveConflict(
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:02:00Z" },
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:01:00Z" },
    );
    expect(result).toBe("keep_existing");
  });

  it("keeps existing when both timestamps are identical (stability)", () => {
    const result = resolveConflict(
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:01:00Z" },
      { deviceTimestamp: "2024-01-01T10:00:00Z", serverTimestamp: "2024-01-01T10:01:00Z" },
    );
    expect(result).toBe("keep_existing");
  });
});

describe("validateSequenceNumber", () => {
  it("returns 'process' when seq is exactly lastAcked + 1", () => {
    expect(validateSequenceNumber(1, 0)).toBe("process");
    expect(validateSequenceNumber(5, 4)).toBe("process");
    expect(validateSequenceNumber(100, 99)).toBe("process");
  });

  it("returns 'skip' when seq ≤ lastAcked (duplicate)", () => {
    expect(validateSequenceNumber(1, 1)).toBe("skip");
    expect(validateSequenceNumber(1, 5)).toBe("skip");
    expect(validateSequenceNumber(3, 10)).toBe("skip");
  });

  it("returns 'gap' when seq > lastAcked + 1", () => {
    expect(validateSequenceNumber(3, 1)).toBe("gap");
    expect(validateSequenceNumber(10, 5)).toBe("gap");
    expect(validateSequenceNumber(100, 1)).toBe("gap");
  });

  it("throws DomainError for non-positive sequence numbers", () => {
    expect(() => validateSequenceNumber(0, 0)).toThrow(DomainError);
    expect(() => validateSequenceNumber(-1, 0)).toThrow(DomainError);
  });

  it("throws DomainError for non-integer sequence numbers", () => {
    expect(() => validateSequenceNumber(1.5, 0)).toThrow(DomainError);
    expect(() => validateSequenceNumber(NaN, 0)).toThrow(DomainError);
  });

  it("throws DomainError for negative lastAckedSeq", () => {
    expect(() => validateSequenceNumber(1, -1)).toThrow(DomainError);
  });

  it("throws DomainError for non-integer lastAckedSeq", () => {
    expect(() => validateSequenceNumber(1, 0.5)).toThrow(DomainError);
  });
});

describe("computeSha256", () => {
  it("produces a 64-character hex string", () => {
    const hash = computeSha256("hello world");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces known hash for known input", () => {
    // SHA-256 of "hello world" is well-known
    const hash = computeSha256("hello world");
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = computeSha256("data1");
    const hash2 = computeSha256("data2");
    expect(hash1).not.toBe(hash2);
  });

  it("is deterministic — same input always produces same output", () => {
    const hash1 = computeSha256("test data");
    const hash2 = computeSha256("test data");
    expect(hash1).toBe(hash2);
  });

  it("handles empty string", () => {
    const hash = computeSha256("");
    expect(hash).toHaveLength(64);
    // SHA-256 of "" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("verifyIntegrity", () => {
  it("returns 'valid' when hashes match", () => {
    const hash = "abc123def456";
    expect(verifyIntegrity(hash, hash)).toBe("valid");
  });

  it("returns 'tampered' when hashes differ", () => {
    expect(verifyIntegrity("abc123", "xyz789")).toBe("tampered");
  });

  it("returns 'tampered' for case differences (hashes are case-sensitive)", () => {
    expect(verifyIntegrity("abc123", "ABC123")).toBe("tampered");
  });

  it("returns 'tampered' for empty vs non-empty", () => {
    expect(verifyIntegrity("", "abc")).toBe("tampered");
  });

  it("returns 'valid' for empty strings", () => {
    expect(verifyIntegrity("", "")).toBe("valid");
  });
});
