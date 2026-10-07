import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

// GAP-KNOWLEDGE-DOCUMENTS-NEW-01: accept an explicit accessLevel so a document
// is created with the least-privilege visibility chosen by the publisher
// (default "internal"), instead of silently always "internal". Enforced
// server-side via this zod enum.
// GAP-KNOWLEDGE-DOCUMENTS-NEW-05: trim title; max length already bounded at 200.
export const DOCUMENT_ACCESS_LEVELS = ["public", "internal", "restricted", "confidential"] as const;

export const createDocumentBody = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(64).optional(),
  accessLevel: z.enum(DOCUMENT_ACCESS_LEVELS).default("internal"),
});
export type CreateDocumentBody = z.infer<typeof createDocumentBody>;

export const documentViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string(),
  category: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const documentsListSchema = paginatedSchema(documentViewSchema);
