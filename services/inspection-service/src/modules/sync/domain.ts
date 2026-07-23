/**
 * Sync domain — pure functions for offline sync package generation, deterministic
 * serialization, conflict resolution, sequence number validation, and data integrity.
 *
 * No side effects, no DB access, no I/O (except crypto.createHash which is CPU-only).
 * Fully deterministic and property-testable.
 *
 * _Requirements: 6.2, 6.3, 6.5, 6.7, 6.8_
 */

import { createHash } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Timestamps associated with a sync record for conflict resolution. */
export interface SyncTimestamps {
  /** ISO 8601 device timestamp from the mobile device's clock. */
  deviceTimestamp: string;
  /** ISO 8601 server timestamp recorded on receipt. */
  serverTimestamp: string;
}

/** Result of conflict resolution between existing and incoming records. */
export type ConflictResolution = "accept_incoming" | "keep_existing";

/** Result of sequence number validation. */
export type SequenceValidation = "process" | "skip" | "gap";

/** Result of integrity verification. */
export type IntegrityStatus = "valid" | "tampered";

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for sync validation failures.
 * Kept separate from HttpError to maintain pure domain boundary.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 *
 * Guarantees that `deterministicSerialize(JSON.parse(deterministicSerialize(x))) === deterministicSerialize(x)`
 * for any JSON-serializable input. This ensures byte-identical re-serialization
 * for sync package integrity verification.
 *
 * @param obj - Any JSON-serializable value.
 * @returns A JSON string with all object keys sorted lexicographically at every level.
 *
 * _Validates: Requirement 6.7_
 */
export function deterministicSerialize(obj: unknown): string {
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted = Object.keys(value as Record<string, unknown>).sort();
      const result: Record<string, unknown> = {};
      for (const k of sorted) {
        result[k] = (value as Record<string, unknown>)[k];
      }
      return result;
    }
    return value;
  });
}

/**
 * Resolve a conflict between an existing synced record and an incoming one
 * using last-write-wins semantics.
 *
 * Decision logic:
 * 1. Compare device timestamps — later timestamp wins.
 * 2. If device timestamps are identical, use server timestamp as tiebreaker.
 * 3. If both are identical, keep existing (stability — no unnecessary overwrite).
 *
 * @param existing - Timestamps of the record already stored.
 * @param incoming - Timestamps of the newly arriving record.
 * @returns `"accept_incoming"` if the incoming record should replace existing,
 *          `"keep_existing"` otherwise.
 *
 * _Validates: Requirement 6.5_
 */
export function resolveConflict(
  existing: SyncTimestamps,
  incoming: SyncTimestamps,
): ConflictResolution {
  if (incoming.deviceTimestamp > existing.deviceTimestamp) return "accept_incoming";
  if (incoming.deviceTimestamp < existing.deviceTimestamp) return "keep_existing";

  // Device timestamps are identical — use server timestamp as tiebreaker.
  if (incoming.serverTimestamp > existing.serverTimestamp) return "accept_incoming";
  return "keep_existing";
}

/**
 * Validate an incoming sequence number against the last acknowledged sequence.
 *
 * - `skip`: seq ≤ lastAckedSeq — duplicate, already processed (idempotent).
 * - `gap`: seq > lastAckedSeq + 1 — missing messages in between.
 * - `process`: seq === lastAckedSeq + 1 — next expected message.
 *
 * @param incomingSeq - The sequence number from the incoming sync upload.
 * @param lastAckedSeq - The last successfully acknowledged sequence number.
 * @returns The validation result indicating how to handle this upload.
 * @throws {DomainError} with code `INVALID_SEQUENCE_NUMBER` if incomingSeq is not a positive integer.
 *
 * _Validates: Requirements 6.2, 6.3, 6.8_
 */
export function validateSequenceNumber(
  incomingSeq: number,
  lastAckedSeq: number,
): SequenceValidation {
  if (!Number.isInteger(incomingSeq) || incomingSeq < 1) {
    throw new DomainError(
      "INVALID_SEQUENCE_NUMBER",
      `Sequence number must be a positive integer, got ${incomingSeq}`,
      { incomingSeq },
    );
  }

  if (!Number.isInteger(lastAckedSeq) || lastAckedSeq < 0) {
    throw new DomainError(
      "INVALID_LAST_ACKED_SEQ",
      `Last acknowledged sequence must be a non-negative integer, got ${lastAckedSeq}`,
      { lastAckedSeq },
    );
  }

  if (incomingSeq <= lastAckedSeq) return "skip";
  if (incomingSeq > lastAckedSeq + 1) return "gap";
  return "process";
}

/**
 * Compute the SHA-256 hex hash of a string payload.
 *
 * Used for sync package checksums and evidence integrity verification.
 *
 * @param data - The string data to hash.
 * @returns The lowercase hex-encoded SHA-256 digest.
 *
 * _Validates: Requirement 6.4 (integrity via SHA-256)_
 */
export function computeSha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Verify data integrity by comparing a stored hash against a freshly computed hash.
 *
 * Simple constant-meaning comparison (not timing-safe since this is not a secret).
 *
 * @param storedHash - The hash recorded at creation/upload time.
 * @param computedHash - The hash recomputed from current data.
 * @returns `"valid"` if hashes match, `"tampered"` if they differ.
 *
 * _Validates: Requirement 6.4_
 */
export function verifyIntegrity(
  storedHash: string,
  computedHash: string,
): IntegrityStatus {
  return storedHash === computedHash ? "valid" : "tampered";
}
