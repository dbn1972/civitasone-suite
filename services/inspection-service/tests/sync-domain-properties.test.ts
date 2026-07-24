/**
 * Property-based tests for sync domain logic.
 *
 * **Property 23: Deterministic Serialization** — deterministicSerialize(parse(deterministicSerialize(x)))
 * === deterministicSerialize(x)
 *
 * **Property 24: Conflict Resolution Semantics** — accept_incoming iff deviceTimestamp greater;
 * tiebreaker on serverTimestamp
 *
 * **Property 25: SHA-256 Integrity Verification** — valid iff hashes identical, tampered otherwise
 *
 * Pure functions — no mocks, no I/O, no DB.
 *
 * **Validates: Requirements 6.4, 6.5, 6.7**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  deterministicSerialize,
  resolveConflict,
  computeSha256,
  verifyIntegrity,
  type SyncTimestamps,
} from "../src/modules/sync/domain.js";

// ── Generators ────────────────────────────────────────────────────────────────

/**
 * Generate arbitrary JSON-serializable values (objects, arrays, primitives).
 * Uses fc.jsonValue which produces values that survive JSON.stringify round-trips.
 */
const jsonValueArb = fc.jsonValue();

/**
 * Generate an arbitrary JSON object (non-null, non-array object at root).
 */
const jsonObjectArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.jsonValue(),
  { minKeys: 1, maxKeys: 8 },
);

/**
 * Generate nested JSON objects to test deep key sorting.
 */
const nestedJsonObjectArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.oneof(
    fc.jsonValue(),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.jsonValue(),
      { minKeys: 0, maxKeys: 4 },
    ),
  ),
  { minKeys: 1, maxKeys: 6 },
);

/**
 * Generate a valid ISO 8601 timestamp string.
 */
const isoTimestampArb = fc.date({
  min: new Date("2020-01-01T00:00:00Z"),
  max: new Date("2030-12-31T23:59:59Z"),
}).map((d) => d.toISOString());

/**
 * Generate SyncTimestamps with ISO device and server timestamps.
 */
const syncTimestampsArb: fc.Arbitrary<SyncTimestamps> = fc.record({
  deviceTimestamp: isoTimestampArb,
  serverTimestamp: isoTimestampArb,
});

/**
 * Generate a hex-encoded SHA-256 hash (64 hex chars).
 */
const sha256HashArb = fc.hexaString({ minLength: 64, maxLength: 64 });

/**
 * Generate arbitrary non-empty string payloads for hashing.
 */
const payloadArb = fc.string({ minLength: 1, maxLength: 500 });

// ── Property 23: Deterministic Serialization ──────────────────────────────────

describe("Property 23: Deterministic Serialization", () => {
  /**
   * **Validates: Requirements 6.7**
   *
   * For any JSON-serializable value, serializing, parsing, and re-serializing
   * produces byte-identical output.
   */
  it("deterministicSerialize(parse(deterministicSerialize(x))) === deterministicSerialize(x) for any JSON value", () => {
    fc.assert(
      fc.property(
        jsonValueArb,
        (value) => {
          const serialized = deterministicSerialize(value);
          const reparsed = JSON.parse(serialized);
          const reSerialized = deterministicSerialize(reparsed);

          expect(reSerialized).toBe(serialized);
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 6.7**
   *
   * For any JSON object with multiple keys, the output is deterministic
   * regardless of original key insertion order.
   */
  it("key order does not affect serialization output", () => {
    fc.assert(
      fc.property(
        jsonObjectArb,
        (obj) => {
          // Create a version with reversed key order
          const keys = Object.keys(obj);
          const reversed: Record<string, unknown> = {};
          for (let i = keys.length - 1; i >= 0; i--) {
            reversed[keys[i]!] = obj[keys[i]!];
          }

          const result1 = deterministicSerialize(obj);
          const result2 = deterministicSerialize(reversed);

          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.7**
   *
   * For nested objects, keys at every level appear in lexicographic order
   * in the serialized output string.
   */
  it("nested objects have keys sorted at all levels in the output string", () => {
    fc.assert(
      fc.property(
        nestedJsonObjectArb,
        (obj) => {
          const serialized = deterministicSerialize(obj);

          // Extract keys from the serialized JSON string using regex
          // For each object in the output, keys should appear sorted.
          // We verify by comparing deterministicSerialize to a manual sort approach.
          const manualSorted = JSON.stringify(
            JSON.parse(serialized),
            (_key, value: unknown) => {
              if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                const sorted = Object.keys(value as Record<string, unknown>).sort();
                const result: Record<string, unknown> = {};
                for (const k of sorted) {
                  result[k] = (value as Record<string, unknown>)[k];
                }
                return result;
              }
              return value;
            },
          );

          // The output of deterministicSerialize on the parsed value should equal
          // a re-application of the same sorting logic
          expect(serialized).toBe(manualSorted);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.7**
   *
   * Idempotent: multiple applications produce the same result.
   */
  it("applying deterministicSerialize multiple times is idempotent on the parsed representation", () => {
    fc.assert(
      fc.property(
        jsonValueArb,
        (value) => {
          const once = deterministicSerialize(value);
          const twice = deterministicSerialize(JSON.parse(once));
          const thrice = deterministicSerialize(JSON.parse(twice));

          expect(once).toBe(twice);
          expect(twice).toBe(thrice);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ── Property 24: Conflict Resolution Semantics ────────────────────────────────

describe("Property 24: Conflict Resolution Semantics", () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * accept_incoming iff incoming deviceTimestamp is strictly greater than existing.
   */
  it("accept_incoming when incoming deviceTimestamp > existing deviceTimestamp", () => {
    fc.assert(
      fc.property(
        isoTimestampArb,
        isoTimestampArb,
        isoTimestampArb,
        (existingDevice, existingServer, incomingServer) => {
          // Create an incoming timestamp strictly after existing
          const existingDate = new Date(existingDevice);
          const incomingDevice = new Date(existingDate.getTime() + 1).toISOString();

          const existing: SyncTimestamps = {
            deviceTimestamp: existingDevice,
            serverTimestamp: existingServer,
          };
          const incoming: SyncTimestamps = {
            deviceTimestamp: incomingDevice,
            serverTimestamp: incomingServer,
          };

          expect(resolveConflict(existing, incoming)).toBe("accept_incoming");
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * keep_existing when incoming deviceTimestamp is strictly less than existing.
   */
  it("keep_existing when incoming deviceTimestamp < existing deviceTimestamp", () => {
    fc.assert(
      fc.property(
        isoTimestampArb,
        isoTimestampArb,
        isoTimestampArb,
        (existingDevice, existingServer, incomingServer) => {
          // Create an incoming timestamp strictly before existing
          const existingDate = new Date(existingDevice);
          const incomingDevice = new Date(existingDate.getTime() - 1).toISOString();

          const existing: SyncTimestamps = {
            deviceTimestamp: existingDevice,
            serverTimestamp: existingServer,
          };
          const incoming: SyncTimestamps = {
            deviceTimestamp: incomingDevice,
            serverTimestamp: incomingServer,
          };

          expect(resolveConflict(existing, incoming)).toBe("keep_existing");
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * When deviceTimestamps are equal, use serverTimestamp as tiebreaker:
   * accept_incoming iff incoming serverTimestamp > existing serverTimestamp.
   */
  it("tiebreaker: accept_incoming when same deviceTimestamp but incoming serverTimestamp > existing", () => {
    fc.assert(
      fc.property(
        isoTimestampArb,
        isoTimestampArb,
        (sharedDevice, existingServer) => {
          // Create incoming server timestamp strictly after existing
          const existingDate = new Date(existingServer);
          const incomingServer = new Date(existingDate.getTime() + 1).toISOString();

          const existing: SyncTimestamps = {
            deviceTimestamp: sharedDevice,
            serverTimestamp: existingServer,
          };
          const incoming: SyncTimestamps = {
            deviceTimestamp: sharedDevice,
            serverTimestamp: incomingServer,
          };

          expect(resolveConflict(existing, incoming)).toBe("accept_incoming");
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * When both deviceTimestamp and serverTimestamp are equal, keep_existing
   * (stability — no unnecessary overwrite).
   */
  it("keep_existing when both timestamps are identical (stability)", () => {
    fc.assert(
      fc.property(
        isoTimestampArb,
        isoTimestampArb,
        (deviceTs, serverTs) => {
          const existing: SyncTimestamps = {
            deviceTimestamp: deviceTs,
            serverTimestamp: serverTs,
          };
          const incoming: SyncTimestamps = {
            deviceTimestamp: deviceTs,
            serverTimestamp: serverTs,
          };

          expect(resolveConflict(existing, incoming)).toBe("keep_existing");
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * Biconditional: the full decision logic matches the spec exactly.
   */
  it("biconditional: resolveConflict matches last-write-wins with server tiebreaker", () => {
    fc.assert(
      fc.property(
        syncTimestampsArb,
        syncTimestampsArb,
        (existing, incoming) => {
          const result = resolveConflict(existing, incoming);

          if (incoming.deviceTimestamp > existing.deviceTimestamp) {
            expect(result).toBe("accept_incoming");
          } else if (incoming.deviceTimestamp < existing.deviceTimestamp) {
            expect(result).toBe("keep_existing");
          } else {
            // Device timestamps equal — server tiebreaker
            if (incoming.serverTimestamp > existing.serverTimestamp) {
              expect(result).toBe("accept_incoming");
            } else {
              expect(result).toBe("keep_existing");
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ── Property 25: SHA-256 Integrity Verification ───────────────────────────────

describe("Property 25: SHA-256 Integrity Verification", () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any data, computing SHA-256 and verifying with the same hash returns "valid".
   */
  it("valid when stored hash matches recomputed hash", () => {
    fc.assert(
      fc.property(
        payloadArb,
        (data) => {
          const hash = computeSha256(data);
          const result = verifyIntegrity(hash, hash);

          expect(result).toBe("valid");
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * For any two distinct payloads, their SHA-256 hashes differ and verification
   * returns "tampered".
   */
  it("tampered when data is modified (different hashes)", () => {
    fc.assert(
      fc.property(
        payloadArb,
        payloadArb.filter((s) => s.length > 0),
        (original, modification) => {
          // Ensure we actually have different data
          const modified = original + modification;
          if (modified === original) return; // skip trivial case

          const originalHash = computeSha256(original);
          const modifiedHash = computeSha256(modified);

          const result = verifyIntegrity(originalHash, modifiedHash);
          expect(result).toBe("tampered");
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Biconditional: valid iff storedHash === computedHash.
   */
  it("biconditional: valid iff hashes are identical strings", () => {
    fc.assert(
      fc.property(
        sha256HashArb,
        sha256HashArb,
        (hash1, hash2) => {
          const result = verifyIntegrity(hash1, hash2);

          if (hash1 === hash2) {
            expect(result).toBe("valid");
          } else {
            expect(result).toBe("tampered");
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * SHA-256 is deterministic: same input always produces same hash.
   */
  it("computeSha256 is deterministic for the same input", () => {
    fc.assert(
      fc.property(
        payloadArb,
        (data) => {
          const hash1 = computeSha256(data);
          const hash2 = computeSha256(data);

          expect(hash1).toBe(hash2);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * SHA-256 output is always a 64-character lowercase hex string.
   */
  it("computeSha256 always returns 64-char lowercase hex", () => {
    fc.assert(
      fc.property(
        payloadArb,
        (data) => {
          const hash = computeSha256(data);

          expect(hash).toHaveLength(64);
          expect(hash).toMatch(/^[0-9a-f]{64}$/);
        },
      ),
      { numRuns: 200 },
    );
  });
});
