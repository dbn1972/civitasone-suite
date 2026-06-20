import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createDocumentBody = z.object({
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(64).optional(),
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
