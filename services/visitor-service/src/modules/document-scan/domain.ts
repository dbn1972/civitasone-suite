/**
 * visitor-service: document-scan — pure domain logic.
 *
 * Owns:
 *   - Image validation (MIME type, size, resolution)
 *   - Confidence scoring and low-confidence flag detection
 *   - Document type heuristic detection (Aadhaar, PAN, DL, Voter ID)
 *   - Raw OCR output mapping to structured OcrExtraction
 *
 * All functions are pure (no side effects, no DB/Redis calls).
 *
 * Requirements validated: 6.2, 6.3, 6.4, 6.5
 */
import type { OcrExtraction } from "./ocr-adapter.js";

// ---------------------------------------------------------------------------
// Image Validation
// ---------------------------------------------------------------------------

/** Accepted MIME types for document image upload. */
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/** Maximum file size in bytes (10 MB). */
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate an uploaded document image.
 *
 * Accepts JPEG and PNG images up to 10 MB in size.
 *
 * @param mimeType - The MIME type of the uploaded file
 * @param sizeBytes - The file size in bytes
 * @returns Validation result with error message if invalid
 */
export function validateImage(mimeType: string, sizeBytes: number): ImageValidationResult {
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `unsupported image type '${mimeType}'; accepted: image/jpeg, image/png`,
    };
  }

  if (sizeBytes <= 0) {
    return { valid: false, error: "image file is empty" };
  }

  if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `image size ${sizeBytes} bytes exceeds maximum of ${MAX_IMAGE_SIZE_BYTES} bytes (10 MB)`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

/** Confidence threshold below which a field is considered low-confidence. */
const CONFIDENCE_THRESHOLD = 80;

/**
 * Determine if an OCR result has low confidence on critical fields.
 *
 * Returns true if `full_name` or `id_document_number` confidence score is
 * below the threshold (80). If neither field has a score entry, returns false
 * (absence of score is not treated as low confidence).
 *
 * @param scores - Per-field confidence scores (0–100)
 * @returns true if any critical field is below the confidence threshold
 */
export function isLowConfidence(scores: Record<string, number>): boolean {
  const nameScore = scores["full_name"];
  const idScore = scores["id_document_number"];

  if (typeof nameScore === "number" && nameScore < CONFIDENCE_THRESHOLD) {
    return true;
  }

  if (typeof idScore === "number" && idScore < CONFIDENCE_THRESHOLD) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Document Type Detection
// ---------------------------------------------------------------------------

/** Supported Indian ID document types. */
export type DocumentType = "aadhaar" | "pan" | "driving_license" | "voter_id";

/**
 * Detect the type of Indian identity document from the extracted ID number.
 *
 * Heuristics:
 *   - 12 digits → Aadhaar
 *   - 10 alphanumeric matching XXXXX1234X → PAN
 *   - Starts with state code prefix (2 alpha) + numeric → Driving License
 *   - 3 alpha + 7 digits (e.g., ABC1234567) → Voter ID
 *   - Otherwise → null (unknown)
 *
 * @param extractedNumber - The raw document number string from OCR
 * @returns Detected document type or null if unrecognized
 */
export function detectDocumentType(extractedNumber: string): DocumentType | null {
  if (!extractedNumber || extractedNumber.trim().length === 0) {
    return null;
  }

  const cleaned = extractedNumber.replace(/[\s-]/g, "").toUpperCase();

  // Aadhaar: exactly 12 digits
  if (/^\d{12}$/.test(cleaned)) {
    return "aadhaar";
  }

  // PAN: exactly 10 chars, XXXXX1234X pattern (5 alpha + 4 digit + 1 alpha)
  if (/^[A-Z]{5}\d{4}[A-Z]$/.test(cleaned)) {
    return "pan";
  }

  // Driving License: state code (2 alpha) + optional separator + digits (varies by state)
  // Common patterns: DL-0420110012345, KA0120170012345, MH0220190012345
  if (/^[A-Z]{2}\d{2,}/.test(cleaned) && cleaned.length >= 10 && cleaned.length <= 20) {
    return "driving_license";
  }

  // Voter ID (EPIC): 3 alpha + 7 digits (e.g., ABC1234567)
  if (/^[A-Z]{3}\d{7}$/.test(cleaned)) {
    return "voter_id";
  }

  return null;
}

// ---------------------------------------------------------------------------
// OCR Field Mapping
// ---------------------------------------------------------------------------

/**
 * Map raw OCR JSON output (provider-agnostic) to a structured OcrExtraction.
 *
 * Handles multiple possible field name formats from different OCR providers.
 * Falls back gracefully when fields are missing — returns null for absent fields.
 *
 * @param rawOutput - Raw OCR provider output (unknown shape)
 * @returns Structured OcrExtraction with normalized field names
 */
export function mapOcrFields(rawOutput: unknown): OcrExtraction {
  if (!rawOutput || typeof rawOutput !== "object") {
    return {
      fullName: null,
      dateOfBirth: null,
      idDocumentNumber: null,
      idDocumentType: null,
      address: null,
      photoRegionKey: null,
      confidenceScores: {},
    };
  }

  const data = rawOutput as Record<string, unknown>;

  // Look for nested fields object or use top-level
  const fields = (data.fields ?? data.result ?? data.data ?? data) as Record<string, unknown>;
  const scores = extractScores(data);

  const fullName = extractStr(fields, ["full_name", "fullName", "name", "Name"]);
  const dateOfBirth = extractStr(fields, ["date_of_birth", "dateOfBirth", "dob", "DOB", "Date of Birth"]);
  const idDocumentNumber = extractStr(fields, ["id_document_number", "idDocumentNumber", "document_number", "id_number", "ID Number"]);
  const idDocumentType = extractStr(fields, ["id_document_type", "idDocumentType", "document_type", "type"]);
  const address = extractStr(fields, ["address", "addr", "Address"]);
  const photoRegionKey = extractStr(fields, ["photo_region_key", "photoRegionKey", "photo_region", "photo"]);

  return {
    fullName,
    dateOfBirth,
    idDocumentNumber,
    idDocumentType: idDocumentType ?? (idDocumentNumber ? detectDocumentType(idDocumentNumber) : null),
    address,
    photoRegionKey,
    confidenceScores: scores,
  };
}

// ---------------------------------------------------------------------------
// Blacklist Screening Contract
// ---------------------------------------------------------------------------

/**
 * Determine whether blacklist screening should be performed for an extraction.
 *
 * Screening must be attempted for every extraction that has an id_document_number.
 * This is a domain contract check — the actual screening is performed by the
 * consumer against the Redis blacklist set.
 *
 * @param extraction - The OCR extraction result
 * @returns true if screening should be performed
 */
export function shouldScreenBlacklist(extraction: OcrExtraction): boolean {
  return extraction.idDocumentNumber !== null && extraction.idDocumentNumber.length > 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

function extractScores(data: Record<string, unknown>): Record<string, number> {
  const raw = data.confidence_scores ?? data.confidenceScores ?? data.scores;
  if (!raw || typeof raw !== "object") return {};

  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === "number") {
      result[key] = val;
    }
  }
  return result;
}
