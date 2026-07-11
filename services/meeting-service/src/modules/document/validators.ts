/**
 * document module — Zod request validators + document-domain constants (route boundary).
 *
 * Parsed at the route boundary before any command is published (CQRS). This module also
 * owns the pure, side-effect-free document rules shared by the routes AND the consumer
 * (defence-in-depth), so there is a single source of truth for:
 *
 *   • the allowed upload file types (Req 15.1 — PDF/DOCX/XLSX/PPTX/PNG/JPG, max 50MB),
 *   • server-side MIME validation ("validate MIME type server-side, not just extension" —
 *     steering: File uploads): both the declared MIME must be whitelisted AND the actual
 *     bytes must sniff to a family consistent with it,
 *   • the confidentiality classification model + rank ordering (Req 19.1), and
 *   • classification-based read access control (Req 15.5, 19.3, 19.7): an unauthorized
 *     Secret/Top_Secret access must be answered with a generic 404 (never revealing
 *     existence), and Top_Secret is view-only (no download).
 *
 * _Requirements: 4.1, 15.1, 15.2, 15.5, 19.1, 19.3, 19.4, 19.7_
 */
import { z } from "zod";

// ─── Upload file-type + size policy (Req 15.1) ───────────────────────────────────

/** Maximum individual file size — 50 MB (Req 15.1). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Server-side MIME whitelist (Req 15.1). Maps each allowed MIME type to the file
 * extensions that legitimately carry it. The declared extension alone is never trusted;
 * see `assertMimeConsistent` for the byte-level sniff.
 */
export const MIME_WHITELIST: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
} as const;

export const ALLOWED_MIME_TYPES = Object.keys(MIME_WHITELIST);

/** Broad content family a byte signature belongs to — used to cross-check the declared MIME. */
export type MimeFamily = "pdf" | "zip_ooxml" | "png" | "jpeg" | "unknown";

/** The family each whitelisted MIME type must sniff to (OOXML docx/xlsx/pptx are all ZIP). */
const MIME_FAMILY: Readonly<Record<string, MimeFamily>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip_ooxml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip_ooxml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "zip_ooxml",
  "image/png": "png",
  "image/jpeg": "jpeg",
};

/**
 * Sniff the content family from the leading magic bytes of `buffer`. This is the
 * server-side check that a file is what its MIME type claims (not merely what its
 * extension says). OOXML office files are ZIP containers, so docx/xlsx/pptx all sniff
 * as `zip_ooxml` (`PK\x03\x04`); finer discrimination is not needed for the whitelist.
 */
export function sniffMimeFamily(buffer: Buffer): MimeFamily {
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "pdf"; // "%PDF"
  }
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
    return "zip_ooxml"; // "PK.." (ZIP local file / empty / spanned header)
  }
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "png"; // "\x89PNG"
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg"; // JPEG SOI + marker
  }
  return "unknown";
}

/** True when the declared MIME type is whitelisted (Req 15.1). */
export function isAllowedMime(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_WHITELIST, mimeType);
}

/** True when the file name's extension is one of the extensions legitimately carrying `mimeType`. */
export function extensionMatchesMime(fileName: string, mimeType: string): boolean {
  const allowed = MIME_WHITELIST[mimeType];
  if (!allowed) return false;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return false;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return allowed.includes(ext);
}

/** Reasons `assertMimeConsistent` can reject an upload (all map to 400 DOCUMENT_INVALID_TYPE). */
export type MimeRejectReason = "mime_not_allowed" | "extension_mismatch" | "content_mismatch";

/**
 * Server-side MIME validation (steering: "validate MIME type server-side, not just
 * extension"): the declared `mimeType` must be whitelisted, the `fileName` extension
 * must be consistent with it, and the actual bytes must sniff to the expected family.
 * Returns null when the upload is consistent, or a reject reason otherwise. Pure — used
 * by BOTH the upload route (boundary 400) and the consumer (defence-in-depth → DLQ).
 */
export function checkMimeConsistent(fileName: string, mimeType: string, buffer: Buffer): MimeRejectReason | null {
  if (!isAllowedMime(mimeType)) return "mime_not_allowed";
  if (!extensionMatchesMime(fileName, mimeType)) return "extension_mismatch";
  const expected = MIME_FAMILY[mimeType];
  if (expected && sniffMimeFamily(buffer) !== expected) return "content_mismatch";
  return null;
}

// ─── Classification model (Req 19.1) ─────────────────────────────────────────────

export const CLASSIFICATIONS = ["public", "internal", "confidential", "secret", "top_secret"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** Ordinal rank of each classification (higher = more restricted). */
export const CLASSIFICATION_RANK: Readonly<Record<Classification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  secret: 3,
  top_secret: 4,
};

export function isClassification(value: string): value is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}

/** Rank of a (possibly unknown) classification string; unknown → treated as `secret` (fail-closed). */
export function rankOf(classification: string): number {
  return isClassification(classification) ? CLASSIFICATION_RANK[classification] : CLASSIFICATION_RANK.secret;
}

// ─── Classification-based access control (Req 15.5, 19.3, 19.7) ───────────────────

/** Roles cleared for Secret / Top_Secret content (need-to-know officials). */
const CLEARED_ROLES = ["meeting_admin", "committee_secretary", "committee_chairperson", "security_officer", "tenant_admin", "super_admin", "admin"];
/** Roles cleared for Confidential content (committee membership + above). */
const CONFIDENTIAL_ROLES = ["committee_member", ...CLEARED_ROLES];

/**
 * Maximum classification rank a set of roles is cleared to read:
 *   • cleared officials → `top_secret` (4)
 *   • committee members → `confidential` (2)
 *   • any other authenticated meeting role → `internal` (1)
 * The caller has already passed `requireRole` (a meeting read role), so the floor is 1.
 */
export function maxClearanceRank(roles: string[]): number {
  if (roles.some((r) => CLEARED_ROLES.includes(r))) return CLASSIFICATION_RANK.top_secret;
  if (roles.some((r) => CONFIDENTIAL_ROLES.includes(r))) return CLASSIFICATION_RANK.confidential;
  return CLASSIFICATION_RANK.internal;
}

/** True when `roles` may read content at `classification` (Req 19.3). */
export function canAccessClassification(roles: string[], classification: string): boolean {
  return rankOf(classification) <= maxClearanceRank(roles);
}

/**
 * True when a document at `classification` may be downloaded/printed. Top_Secret is
 * view-only (Req 19.4): no download/print even for cleared users. Everything at or below
 * Secret is downloadable by a user who is cleared for it (watermarking is applied by the
 * render/compile path).
 */
export function isDownloadAllowed(classification: string): boolean {
  return rankOf(classification) < CLASSIFICATION_RANK.top_secret;
}

// ─── Document types (Req 15.2) ───────────────────────────────────────────────────

export const DOCUMENT_TYPES = [
  "agenda_note",
  "supporting_document",
  "previous_minutes",
  "atr",
  "presentation",
  "financial_statement",
  "compliance_checklist",
  "agenda_book",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// ─── Zod schemas ─────────────────────────────────────────────────────────────────

const classificationEnum = z.enum(CLASSIFICATIONS);
const documentTypeEnum = z.enum(DOCUMENT_TYPES);

/**
 * Upload body (JSON, base64-encoded content). The file bytes are decoded, size- and
 * MIME-validated, and staged to object storage by the route BEFORE the `document.upload`
 * command is published — the queue message only ever carries the small storage pointer +
 * metadata, never the file bytes (steering: queue messages small, no >1MB payloads).
 *
 * `contentBase64` size is bounded here as a first cut; the exact decoded-byte limit
 * (Req 15.1, 50MB) is enforced in the route against the decoded buffer.
 */
export const uploadDocumentBody = z.object({
  fileName:          z.string().min(1).max(512),
  mimeType:          z.string().min(1).max(128),
  /** Base64-encoded file content (bounded generously; decoded size checked in the route). */
  contentBase64:     z.string().min(1).max(Math.ceil((MAX_FILE_SIZE_BYTES * 4) / 3) + 1024),
  classification:    classificationEnum.default("internal"),
  documentType:      documentTypeEnum.optional(),
  agendaItemId:      z.string().uuid().optional(),
  retentionYears:    z.coerce.number().int().min(0).max(100).optional(),
  /** Set when this upload replaces an existing document (version control, Req 15.4). */
  previousVersionId: z.string().uuid().optional(),
});
export type UploadDocumentBody = z.infer<typeof uploadDocumentBody>;

/** Remove (soft-delete) body — optimistic-lock version + optional reason. */
export const removeDocumentBody = z.object({
  version: z.coerce.number().int().nonnegative().optional(),
  reason:  z.string().max(1024).optional(),
});
export type RemoveDocumentBody = z.infer<typeof removeDocumentBody>;

/** Document list query — optional filters by agenda item + document type. */
export const documentListQuery = z.object({
  agendaItemId: z.string().uuid().optional(),
  documentType: documentTypeEnum.optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuery>;

export const meetingIdParam = z.object({ meetingId: z.string().uuid() });
export const documentIdParam = z.object({
  meetingId:  z.string().uuid(),
  documentId: z.string().uuid(),
});
