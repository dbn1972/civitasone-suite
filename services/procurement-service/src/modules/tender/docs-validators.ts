import { z } from "zod";
import { DOC_TYPES } from "./docs-domain.js";

/**
 * GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-06: tender documents are bid-pack
 * paperwork. Only a registered storageRef is stored here (the bytes live in the
 * upload service), so this is where a declared type/size limit can be enforced.
 * Executable / script types are never tender documents.
 */
export const TENDER_DOC_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB
export const TENDER_DOC_MIME_ALLOWLIST = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "image/png",
  "image/jpeg",
  "text/plain",
] as const;
const BLOCKED_EXTENSION = /\.(?:exe|dll|bat|cmd|com|msi|scr|sh|ps1|vbs|js|jar|apk|html?|svg)$/i;

export const addDocBody = z.object({
  docType:   z.enum(DOC_TYPES).default("other"),
  title:     z.string().min(1).max(256),
  storageRef:z.string().min(1).max(1024),
  mimeType:  z.string().max(128).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
}).superRefine((v, ctx) => {
  if (v.mimeType !== undefined && !(TENDER_DOC_MIME_ALLOWLIST as readonly string[]).includes(v.mimeType.toLowerCase())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mimeType"], message: "file type is not allowed for a tender document" });
  }
  if (v.sizeBytes !== undefined && v.sizeBytes > TENDER_DOC_MAX_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sizeBytes"], message: `file exceeds the ${TENDER_DOC_MAX_BYTES / (1024 * 1024)} MiB limit` });
  }
  if (BLOCKED_EXTENSION.test(v.storageRef) || BLOCKED_EXTENSION.test(v.title)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["storageRef"], message: "executable or script files cannot be attached to a tender" });
  }
});
export type AddDocBody = z.infer<typeof addDocBody>;

export const createCorrigendumBody = z.object({
  title:             z.string().min(1).max(256),
  description:       z.string().max(2000).optional(),
  storageRef:        z.string().max(1024).optional(),
  newBidClosingDate: z.string().optional(),
});
export type CreateCorrigendumBody = z.infer<typeof createCorrigendumBody>;

export const republishCorrigendumBody = z.object({
  notes: z.string().max(500).optional(),
});
export type RepublishCorrigendumBody = z.infer<typeof republishCorrigendumBody>;

export const createPrebidQueryBody = z.object({
  question: z.string().min(3).max(2000),
  vendorId: z.string().uuid().optional(),
});
export type CreatePrebidQueryBody = z.infer<typeof createPrebidQueryBody>;

export const answerPrebidQueryBody = z.object({
  answer: z.string().min(1).max(2000),
});
export type AnswerPrebidQueryBody = z.infer<typeof answerPrebidQueryBody>;

export const tenderIdParam = z.object({ id: z.string().uuid() });
export const corrigendumIdParam = z.object({ id: z.string().uuid(), corrigendumId: z.string().uuid() });
export const queryIdParam = z.object({ id: z.string().uuid(), queryId: z.string().uuid() });
