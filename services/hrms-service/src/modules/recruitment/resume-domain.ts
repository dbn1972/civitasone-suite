/**
 * Candidate resume versioning domain (pure, no I/O) — checklist R-RA-0087.
 *
 * A candidate may hold MULTIPLE resume versions; exactly one is the ACTIVE
 * resume used downstream (screening, shortlist, interview pack). This module
 * holds the version-numbering and upload-validation rules. Storage of the file
 * itself is behind a seam (an object-store key is recorded here); we never keep
 * the bytes in Postgres.
 *
 * HONEST NOTE ON VALIDATION SCOPE: validateResumeUpload checks the *declared*
 * metadata (the MIME type and byte size the caller asserts, and that the object
 * key is inside the candidate's own namespace). It does NOT open the object to
 * verify magic bytes or the true size — that requires the object-storage
 * adapter, which is not yet wired. Inspecting the stored object (content-type
 * sniffing + real size) is a follow-up for when the storage seam is filled.
 */

/**
 * The object-store key namespace a candidate's resumes must live under. Enforced
 * so an HR user cannot register an ARBITRARY (e.g. another candidate's or another
 * tenant's) object key as this candidate's resume — an IDOR guard on the key.
 */
export function resumeKeyPrefix(candidateId: string): string {
  return `candidates/${candidateId}/resumes/`;
}

/** Accepted resume document MIME types (checked against the caller-declared type). */
export const RESUME_MIME_TYPES = [
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
] as const;
export type ResumeMimeType = (typeof RESUME_MIME_TYPES)[number];

/** Max resume size: 5 MiB. Government portals cap resume uploads well below this. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/**
 * Next sequential version number for a candidate given the version numbers that
 * already exist. Versions are 1-based and monotonic; gaps (from deletes) are
 * acceptable — we always take max+1 so a re-used number can never collide.
 */
export function nextResumeVersion(existingVersions: number[]): number {
  if (existingVersions.length === 0) return 1;
  return Math.max(...existingVersions) + 1;
}

export interface ResumeUploadInput {
  fileKey: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  /** When set, fileKey MUST start with this prefix (candidate-scoped IDOR guard). */
  expectedKeyPrefix?: string;
}

/**
 * Validate resume upload metadata (declared values — see the module note on
 * validation scope). Returns a list of human-readable errors (empty = valid).
 * The MIME type is checked against the allow-list and, when an expected key
 * prefix is supplied, the object key must sit inside the candidate's namespace.
 */
export function validateResumeUpload(input: ResumeUploadInput): string[] {
  const errors: string[] = [];
  const fileKey = input.fileKey?.trim() ?? "";
  if (fileKey.length === 0) errors.push("fileKey is required");
  if (!input.fileName || input.fileName.trim().length === 0) errors.push("fileName is required");
  if (fileKey.length > 0 && input.expectedKeyPrefix && !fileKey.startsWith(input.expectedKeyPrefix)) {
    errors.push(`fileKey must be within this candidate's namespace ('${input.expectedKeyPrefix}')`);
  }
  if (!(RESUME_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    errors.push(`unsupported resume type '${input.mimeType}' (allowed: PDF, DOC, DOCX)`);
  }
  if (!Number.isInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    errors.push("fileSizeBytes must be a positive integer");
  } else if (input.fileSizeBytes > MAX_RESUME_BYTES) {
    errors.push(`resume exceeds the ${Math.floor(MAX_RESUME_BYTES / (1024 * 1024))} MiB limit`);
  }
  return errors;
}
