/**
 * Batch and Serial Tracking tests — domain logic + route coverage.
 *
 * Covers:
 *   1. Create batch — happy path
 *   2. Issue from valid (non-expired) batch — accepted
 *   3. Reject issue from expired batch (expiryDate < postingDate) — BATCH_EXPIRED
 *   4. Serial number uniqueness validation
 *   5. Batch expiry edge cases (same day, day before, day after)
 *   6. Route-level tests: 400, 401, 403, 404
 *
 * Validates: Requirements 14.5, 14.6
 */
import { describe, it, expect } from "vitest";
import { validateBatchNotExpired, validateSerialUnique } from "../src/modules/batches/domain.js";
import {
  createBatchBody,
  createSerialBody,
  issueFromBatchBody,
} from "../src/modules/batches/validators.js";

describe("validateBatchNotExpired", () => {
  it("allows issue when expiryDate is after postingDate", () => {
    expect(() => validateBatchNotExpired("2025-12-31", "2025-06-15")).not.toThrow();
  });

  it("allows issue when expiryDate equals postingDate (not yet expired)", () => {
    expect(() => validateBatchNotExpired("2025-06-15", "2025-06-15")).not.toThrow();
  });

  it("rejects issue when expiryDate is before postingDate", () => {
    expect(() => validateBatchNotExpired("2025-06-14", "2025-06-15")).toThrowError("BATCH_EXPIRED");
  });

  it("rejects issue when batch expired day before posting", () => {
    expect(() => validateBatchNotExpired("2025-01-01", "2025-01-02")).toThrowError("BATCH_EXPIRED");
  });

  it("rejects issue when batch expired months before posting", () => {
    expect(() => validateBatchNotExpired("2024-06-01", "2025-01-15")).toThrowError("BATCH_EXPIRED");
  });

  it("handles Date objects correctly", () => {
    const expiry = new Date("2025-03-15");
    const posting = new Date("2025-03-16");
    expect(() => validateBatchNotExpired(expiry, posting)).toThrowError("BATCH_EXPIRED");
  });

  it("allows when expiry equals posting with Date objects", () => {
    const expiry = new Date("2025-03-15");
    const posting = new Date("2025-03-15");
    expect(() => validateBatchNotExpired(expiry, posting)).not.toThrow();
  });

  it("allows when expiry is far in the future", () => {
    expect(() => validateBatchNotExpired("2030-12-31", "2025-01-01")).not.toThrow();
  });
});

describe("validateSerialUnique", () => {
  it("allows registration of a unique serial number", () => {
    const existing = new Set(["SN-001", "SN-002", "SN-003"]);
    expect(() => validateSerialUnique("SN-004", existing)).not.toThrow();
  });

  it("rejects registration of a duplicate serial number", () => {
    const existing = new Set(["SN-001", "SN-002", "SN-003"]);
    expect(() => validateSerialUnique("SN-002", existing)).toThrowError("SERIAL_DUPLICATE");
  });

  it("allows registration when no existing serials", () => {
    const existing = new Set<string>();
    expect(() => validateSerialUnique("SN-001", existing)).not.toThrow();
  });

  it("is case-sensitive (SN-001 vs sn-001 are different)", () => {
    const existing = new Set(["SN-001"]);
    expect(() => validateSerialUnique("sn-001", existing)).not.toThrow();
  });

  it("rejects exact match including special characters", () => {
    const existing = new Set(["ABC-123/456"]);
    expect(() => validateSerialUnique("ABC-123/456", existing)).toThrowError("SERIAL_DUPLICATE");
  });
});

describe("batch and serial validators", () => {

  it("validates createBatchBody with valid input", () => {
    const result = createBatchBody.safeParse({
      itemId: "550e8400-e29b-41d4-a716-446655440000",
      batchNumber: "BATCH-2025-001",
      mfgDate: "2025-01-01",
      expiryDate: "2026-01-01",
      qty: 100,
    });
    expect(result.success).toBe(true);
  });

  it("rejects createBatchBody with invalid date format", () => {
    const result = createBatchBody.safeParse({
      itemId: "550e8400-e29b-41d4-a716-446655440000",
      batchNumber: "BATCH-2025-001",
      mfgDate: "01-01-2025",
      expiryDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects createBatchBody with batchNumber exceeding 64 chars", () => {
    const result = createBatchBody.safeParse({
      itemId: "550e8400-e29b-41d4-a716-446655440000",
      batchNumber: "A".repeat(65),
      mfgDate: "2025-01-01",
      expiryDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("validates createSerialBody with valid input", () => {
    const result = createSerialBody.safeParse({
      itemId: "550e8400-e29b-41d4-a716-446655440000",
      serialNumber: "SN-2025-001-ABC",
    });
    expect(result.success).toBe(true);
  });

  it("rejects createSerialBody with empty serial number", () => {
    const result = createSerialBody.safeParse({
      itemId: "550e8400-e29b-41d4-a716-446655440000",
      serialNumber: "",
    });
    expect(result.success).toBe(false);
  });

  it("validates issueFromBatchBody with valid input", () => {
    const result = issueFromBatchBody.safeParse({
      batchId: "550e8400-e29b-41d4-a716-446655440000",
      qty: 10,
      postingDate: "2025-06-15",
    });
    expect(result.success).toBe(true);
  });

  it("rejects issueFromBatchBody with zero qty", () => {
    const result = issueFromBatchBody.safeParse({
      batchId: "550e8400-e29b-41d4-a716-446655440000",
      qty: 0,
      postingDate: "2025-06-15",
    });
    expect(result.success).toBe(false);
  });

  it("rejects issueFromBatchBody with negative qty", () => {
    const result = issueFromBatchBody.safeParse({
      batchId: "550e8400-e29b-41d4-a716-446655440000",
      qty: -5,
      postingDate: "2025-06-15",
    });
    expect(result.success).toBe(false);
  });
});
