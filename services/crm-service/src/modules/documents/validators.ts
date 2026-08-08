/**
 * DM-001/002 zod validators — Document & Attachment Management (BRD §7.12).
 */
import { z } from "zod";

/** Subjects a document can be linked to. `case` lives in helpdesk-service (cross-service). */
export const SUBJECT_TYPES = [
  "lead",
  "contact",
  "account",
  "opportunity",
  "quotation",
  "case",
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const STORAGE_PROVIDERS = ["s3", "knowledge_dms", "external"] as const;

// A conservative filename guard: no path separators, no NULs, bounded length.
// The stored key is server-built; this only shapes the trailing name segment.
const filename = z
  .string()
  .min(1)
  .max(255)
  // Null-byte rejection is intentional for upload path safety.
  // eslint-disable-next-line no-control-regex -- block NUL in filenames
  .regex(/^[^/\\\x00]+$/u, "filename must not contain path separators");

const mimeType = z.string().min(1).max(255);

export const presignBody = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  filename,
  mimeType,
});
export type PresignBody = z.infer<typeof presignBody>;

export const confirmBody = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  docType: z.string().min(1).max(64).nullable().optional(),
  title: z.string().min(1).max(500),
  filename,
  storageKey: z.string().min(1).max(1024),
  mimeType,
  sizeBytes: z.number().int().nonnegative().max(5_368_709_120), // 5 GiB ceiling
  checksum: z.string().max(128).nullable().optional(),
  supersedesId: z.string().uuid().nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "expiryDate must be YYYY-MM-DD").nullable().optional(),
  storageProvider: z.enum(STORAGE_PROVIDERS).default("s3"),
});
export type ConfirmBody = z.infer<typeof confirmBody>;

export const listQuery = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  includeSuperseded: z.coerce.boolean().optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

export const verifyBody = z.object({
  status: z.enum(["verified", "rejected"]),
  reason: z.string().max(1000).nullable().optional(),
});
export type VerifyBody = z.infer<typeof verifyBody>;

/** Internal scan callback (service-secret gated). */
export const scanResultBody = z.object({
  scanStatus: z.enum(["clean", "infected", "error"]),
  detail: z.string().max(1000).nullable().optional(),
});
export type ScanResultBody = z.infer<typeof scanResultBody>;

export const idParam = z.object({ id: z.string().uuid() });

// ── DM-002 document_types admin ─────────────────────────────────────────────

export const createDocumentTypeBody = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/u, "code must be lower_snake"),
  name: z.string().min(1).max(200),
  appliesTo: z.enum(SUBJECT_TYPES),
  mandatory: z.boolean().default(false),
  expiryRequired: z.boolean().default(false),
  verificationRequired: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type CreateDocumentTypeBody = z.infer<typeof createDocumentTypeBody>;

export const updateDocumentTypeBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    appliesTo: z.enum(SUBJECT_TYPES).optional(),
    mandatory: z.boolean().optional(),
    expiryRequired: z.boolean().optional(),
    verificationRequired: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateDocumentTypeBody = z.infer<typeof updateDocumentTypeBody>;
