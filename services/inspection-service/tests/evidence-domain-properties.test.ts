/**
 * Property-based tests for evidence domain logic.
 *
 * **Property 26: MIME Type Validation** — passes iff type in allowed set.
 * **Property 27: File Size Validation** — passes iff sizeBytes ≤ limit.
 *
 * Pure functions — no mocks, no I/O, no DB.
 *
 * **Validates: Requirements 7.3, 7.7**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateMimeType,
  validateFileSize,
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  DomainError,
} from "../src/modules/evidence/domain.js";

// ── Generators ────────────────────────────────────────────────────────────────

/** All default allowed MIME types as an array for use in generators. */
const ALLOWED_LIST = Array.from(ALLOWED_MIME_TYPES);

/** Generate a MIME type from the default allowed set. */
const allowedMimeArb = fc.constantFrom(...ALLOWED_LIST);

/** Generate arbitrary MIME-like strings (type/subtype pattern). */
const arbitraryMimeArb = fc.tuple(
  fc.stringOf(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz".split(""))), { minLength: 1, maxLength: 12 }),
  fc.stringOf(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789_-".split(""))), { minLength: 1, maxLength: 16 }),
).map(([type, subtype]) => `${type}/${subtype}`);

/** Generate a tenant-allowed list of MIME types (1–8 entries). */
const tenantAllowedArb = fc.uniqueArray(arbitraryMimeArb, { minLength: 1, maxLength: 8 });

/** Generate a file size in bytes (non-negative integer). */
const fileSizeArb = fc.nat({ max: 100 * 1024 * 1024 }); // up to 100 MB

/** Generate a custom max file size limit (positive integer). */
const maxBytesArb = fc.integer({ min: 1, max: 100 * 1024 * 1024 });

// ── Property 26: MIME Type Validation ─────────────────────────────────────────

describe("Property 26: MIME Type Validation", () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any MIME type that is in the default allowed set,
   * validateMimeType does not throw.
   */
  it("passes for any MIME type in the default allowed set", () => {
    fc.assert(
      fc.property(
        allowedMimeArb,
        (mimeType) => {
          expect(() => validateMimeType(mimeType)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * For any arbitrary MIME type string NOT in the default allowed set,
   * validateMimeType throws DomainError with code INVALID_MIME_TYPE.
   */
  it("rejects any MIME type not in the default allowed set", () => {
    fc.assert(
      fc.property(
        arbitraryMimeArb.filter((m) => !ALLOWED_MIME_TYPES.has(m)),
        (mimeType) => {
          expect(() => validateMimeType(mimeType)).toThrow(DomainError);
          try {
            validateMimeType(mimeType);
          } catch (e) {
            expect((e as DomainError).code).toBe("INVALID_MIME_TYPE");
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * Biconditional: for any MIME type string, validateMimeType passes iff
   * the type is in the allowed set (default or tenant-specific).
   */
  it("biconditional: passes iff type is in the allowed set (default)", () => {
    fc.assert(
      fc.property(
        fc.oneof(allowedMimeArb, arbitraryMimeArb),
        (mimeType) => {
          const isAllowed = ALLOWED_MIME_TYPES.has(mimeType);

          if (isAllowed) {
            expect(() => validateMimeType(mimeType)).not.toThrow();
          } else {
            expect(() => validateMimeType(mimeType)).toThrow(DomainError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * For any tenant-provided allowlist and any MIME type, validateMimeType
   * passes iff the type is in the tenant allowlist (ignoring default set).
   */
  it("biconditional with tenant allowlist: passes iff type in tenant set", () => {
    fc.assert(
      fc.property(
        tenantAllowedArb,
        arbitraryMimeArb,
        (tenantAllowed, mimeType) => {
          const tenantSet = new Set(tenantAllowed);
          const isAllowed = tenantSet.has(mimeType);

          if (isAllowed) {
            expect(() => validateMimeType(mimeType, tenantAllowed)).not.toThrow();
          } else {
            expect(() => validateMimeType(mimeType, tenantAllowed)).toThrow(DomainError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * When a tenant allowlist is provided, default types NOT in the tenant list
   * are rejected — proving the tenant list fully overrides the default.
   */
  it("tenant allowlist overrides default: default types not in tenant list are rejected", () => {
    fc.assert(
      fc.property(
        tenantAllowedArb.filter((list) => {
          // Ensure tenant list doesn't include all default types
          return !ALLOWED_LIST.every((m) => list.includes(m));
        }),
        (tenantAllowed) => {
          const tenantSet = new Set(tenantAllowed);
          for (const defaultMime of ALLOWED_LIST) {
            if (!tenantSet.has(defaultMime)) {
              expect(() => validateMimeType(defaultMime, tenantAllowed)).toThrow(DomainError);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ── Property 27: File Size Validation ─────────────────────────────────────────

describe("Property 27: File Size Validation", () => {
  /**
   * **Validates: Requirements 7.7**
   *
   * For any file size ≤ the default limit, validateFileSize does not throw.
   */
  it("passes for any file size ≤ default limit", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: DEFAULT_MAX_FILE_SIZE }),
        (sizeBytes) => {
          expect(() => validateFileSize(sizeBytes)).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * For any file size > the default limit, validateFileSize throws
   * DomainError with code FILE_TOO_LARGE.
   */
  it("rejects any file size > default limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: DEFAULT_MAX_FILE_SIZE + 1, max: 100 * 1024 * 1024 }),
        (sizeBytes) => {
          expect(() => validateFileSize(sizeBytes)).toThrow(DomainError);
          try {
            validateFileSize(sizeBytes);
          } catch (e) {
            expect((e as DomainError).code).toBe("FILE_TOO_LARGE");
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * Biconditional: for any file size and limit, validateFileSize passes
   * iff sizeBytes ≤ limit.
   */
  it("biconditional: passes iff sizeBytes ≤ limit", () => {
    fc.assert(
      fc.property(
        fileSizeArb,
        maxBytesArb,
        (sizeBytes, maxBytes) => {
          if (sizeBytes <= maxBytes) {
            expect(() => validateFileSize(sizeBytes, maxBytes)).not.toThrow();
          } else {
            expect(() => validateFileSize(sizeBytes, maxBytes)).toThrow(DomainError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * Boundary case: file size exactly at the limit always passes.
   */
  it("boundary: file size exactly at limit always passes", () => {
    fc.assert(
      fc.property(
        maxBytesArb,
        (limit) => {
          expect(() => validateFileSize(limit, limit)).not.toThrow();
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * Boundary case: file size one byte over the limit always rejects.
   */
  it("boundary: file size one byte over limit always rejects", () => {
    fc.assert(
      fc.property(
        maxBytesArb,
        (limit) => {
          expect(() => validateFileSize(limit + 1, limit)).toThrow(DomainError);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * When no custom limit is provided, DEFAULT_MAX_FILE_SIZE is used as the limit.
   */
  it("uses DEFAULT_MAX_FILE_SIZE when no custom limit provided", () => {
    fc.assert(
      fc.property(
        fileSizeArb,
        (sizeBytes) => {
          const shouldPass = sizeBytes <= DEFAULT_MAX_FILE_SIZE;

          if (shouldPass) {
            expect(() => validateFileSize(sizeBytes)).not.toThrow();
          } else {
            expect(() => validateFileSize(sizeBytes)).toThrow(DomainError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
