/**
 * Evidence domain — pure functions for file validation and integrity verification.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: 7.1, 7.3, 7.4, 7.7_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Result of integrity verification comparing stored vs computed hash.
 * - `valid`      — recomputed hash matches the stored hash.
 * - `tampered`   — recomputed hash differs from the stored hash.
 * - `unverified` — the object could not be recomputed (storage unconfigured or
 *                  object not retrievable); status is deliberately NOT asserted valid.
 */
export type IntegrityStatus = "valid" | "tampered" | "unverified";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Default set of allowed MIME types for evidence uploads.
 * Configurable per tenant via the `tenantAllowed` parameter on `validateMimeType`.
 *
 * _Validates: Requirement 7.3_
 */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "video/mp4",
  "image/heic",
]);

/**
 * Default maximum file size in bytes (25 MB).
 * Configurable per upload via the `maxBytes` parameter on `validateFileSize`.
 *
 * _Validates: Requirement 7.7_
 */
export const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for evidence validation failures.
 * Kept separate from HttpError to maintain pure domain boundary.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Validate that a file's MIME type is in the allowed set.
 *
 * If `tenantAllowed` is provided, it overrides the default allowlist, enabling
 * per-tenant configuration of acceptable evidence file types.
 *
 * @param mimeType - The MIME type string to validate (e.g. "image/jpeg").
 * @param tenantAllowed - Optional tenant-specific allowlist of MIME types.
 * @throws {DomainError} with code `INVALID_MIME_TYPE` if the type is not allowed.
 *
 * _Validates: Requirement 7.3_
 */
export function validateMimeType(mimeType: string, tenantAllowed?: string[]): void {
  const allowed = tenantAllowed ? new Set(tenantAllowed) : ALLOWED_MIME_TYPES;
  if (!allowed.has(mimeType)) {
    throw new DomainError(
      "INVALID_MIME_TYPE",
      `File type '${mimeType}' is not allowed`,
    );
  }
}

/**
 * Validate that a file's size does not exceed the configured maximum.
 *
 * @param sizeBytes - The file size in bytes.
 * @param maxBytes - Optional maximum size in bytes (defaults to 25 MB).
 * @throws {DomainError} with code `FILE_TOO_LARGE` if the size exceeds the limit.
 *
 * _Validates: Requirement 7.7_
 */
export function validateFileSize(sizeBytes: number, maxBytes?: number): void {
  const limit = maxBytes ?? DEFAULT_MAX_FILE_SIZE;
  if (sizeBytes > limit) {
    throw new DomainError(
      "FILE_TOO_LARGE",
      `File size ${sizeBytes} exceeds limit ${limit}`,
    );
  }
}

/**
 * Verify evidence integrity by comparing stored hash against a freshly computed hash.
 *
 * Returns `"valid"` when hashes match, indicating the evidence has not been modified
 * since upload. Returns `"tampered"` when hashes differ, indicating potential modification.
 *
 * @param storedHash - The SHA-256 hash recorded at upload time.
 * @param computedHash - The SHA-256 hash recomputed from current file content.
 * @returns `"valid"` if hashes match, `"tampered"` if they differ.
 *
 * _Validates: Requirement 7.1, 7.4_
 */
export function verifyIntegrity(
  storedHash: string,
  computedHash: string,
): IntegrityStatus {
  return storedHash === computedHash ? "valid" : "tampered";
}


/**
 * Decide the integrity status of an evidence artifact from its stored hash and a
 * freshly recomputed hash.
 *
 * Unlike {@link verifyIntegrity}, this accepts `null` for the recomputed hash to
 * model the case where the object could not be recomputed from storage (storage
 * unconfigured, missing key, or access error). In that case the result is
 * `"unverified"` — the function NEVER reports `"valid"` without proof.
 *
 * @param storedHash - The SHA-256 hash recorded at upload time.
 * @param computedHash - The SHA-256 recomputed from storage, or `null` if unavailable.
 * @returns `"valid"` on match, `"tampered"` on mismatch, `"unverified"` when no
 *          recomputed hash is available.
 *
 * _Validates: Requirement 7.4 (integrity mismatch → tampered, never always-valid)_
 */
export function decideIntegrity(
  storedHash: string,
  computedHash: string | null | undefined,
): IntegrityStatus {
  if (computedHash == null || computedHash.length === 0) {
    return "unverified";
  }
  return storedHash === computedHash ? "valid" : "tampered";
}
