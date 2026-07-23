/**
 * Unit tests for evidence domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.7
 */
import { describe, it, expect } from "vitest";
import {
  validateMimeType,
  validateFileSize,
  verifyIntegrity,
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  DomainError,
} from "../src/modules/evidence/domain.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("ALLOWED_MIME_TYPES", () => {
  it("contains exactly 5 allowed types", () => {
    expect(ALLOWED_MIME_TYPES.size).toBe(5);
  });

  it("includes image/jpeg, image/png, application/pdf, video/mp4, image/heic", () => {
    expect(ALLOWED_MIME_TYPES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/png")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("application/pdf")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("video/mp4")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/heic")).toBe(true);
  });
});

describe("DEFAULT_MAX_FILE_SIZE", () => {
  it("equals 25 MB in bytes", () => {
    expect(DEFAULT_MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
  });
});

// ── validateMimeType ──────────────────────────────────────────────────────────

describe("validateMimeType", () => {
  it("does not throw for allowed MIME type (image/jpeg)", () => {
    expect(() => validateMimeType("image/jpeg")).not.toThrow();
  });

  it("does not throw for allowed MIME type (application/pdf)", () => {
    expect(() => validateMimeType("application/pdf")).not.toThrow();
  });

  it("does not throw for allowed MIME type (video/mp4)", () => {
    expect(() => validateMimeType("video/mp4")).not.toThrow();
  });

  it("throws DomainError for disallowed MIME type", () => {
    expect(() => validateMimeType("application/zip")).toThrow(DomainError);
  });

  it("DomainError has code INVALID_MIME_TYPE", () => {
    try {
      validateMimeType("text/html");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_MIME_TYPE");
    }
  });

  it("error message includes the rejected MIME type", () => {
    expect(() => validateMimeType("image/gif")).toThrow("image/gif");
  });

  it("uses tenant allowlist when provided", () => {
    const tenantAllowed = ["image/gif", "image/webp"];
    expect(() => validateMimeType("image/gif", tenantAllowed)).not.toThrow();
  });

  it("rejects types not in tenant allowlist even if in default set", () => {
    const tenantAllowed = ["image/gif"];
    expect(() => validateMimeType("image/jpeg", tenantAllowed)).toThrow(DomainError);
  });

  it("accepts all default types when no tenant override", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(() => validateMimeType(mime)).not.toThrow();
    }
  });
});

// ── validateFileSize ──────────────────────────────────────────────────────────

describe("validateFileSize", () => {
  it("does not throw when size is under the default limit", () => {
    expect(() => validateFileSize(1024)).not.toThrow();
  });

  it("does not throw when size equals the default limit exactly", () => {
    expect(() => validateFileSize(DEFAULT_MAX_FILE_SIZE)).not.toThrow();
  });

  it("throws DomainError when size exceeds the default limit", () => {
    expect(() => validateFileSize(DEFAULT_MAX_FILE_SIZE + 1)).toThrow(DomainError);
  });

  it("DomainError has code FILE_TOO_LARGE", () => {
    try {
      validateFileSize(DEFAULT_MAX_FILE_SIZE + 1);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("FILE_TOO_LARGE");
    }
  });

  it("error message includes the file size and limit", () => {
    const size = DEFAULT_MAX_FILE_SIZE + 100;
    expect(() => validateFileSize(size)).toThrow(`${size}`);
    expect(() => validateFileSize(size)).toThrow(`${DEFAULT_MAX_FILE_SIZE}`);
  });

  it("uses custom maxBytes when provided", () => {
    const customMax = 10 * 1024 * 1024; // 10 MB
    expect(() => validateFileSize(customMax)).not.toThrow();
    expect(() => validateFileSize(customMax + 1, customMax)).toThrow(DomainError);
  });

  it("does not throw for zero-byte file", () => {
    expect(() => validateFileSize(0)).not.toThrow();
  });
});

// ── verifyIntegrity ───────────────────────────────────────────────────────────

describe("verifyIntegrity", () => {
  const hash = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

  it("returns 'valid' when hashes match", () => {
    expect(verifyIntegrity(hash, hash)).toBe("valid");
  });

  it("returns 'tampered' when hashes differ", () => {
    const different = "0000000000000000000000000000000000000000000000000000000000000000";
    expect(verifyIntegrity(hash, different)).toBe("tampered");
  });

  it("returns 'tampered' for single character difference", () => {
    const almostSame = hash.slice(0, -1) + "0";
    expect(verifyIntegrity(hash, almostSame)).toBe("tampered");
  });

  it("returns 'valid' for empty strings (edge case)", () => {
    expect(verifyIntegrity("", "")).toBe("valid");
  });

  it("returns 'tampered' when one hash is empty", () => {
    expect(verifyIntegrity(hash, "")).toBe("tampered");
    expect(verifyIntegrity("", hash)).toBe("tampered");
  });
});
