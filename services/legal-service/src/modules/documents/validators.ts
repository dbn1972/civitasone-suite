import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createDocumentBody = z.object({
  matterId:       z.string().uuid(),
  parentFolderId: z.string().uuid().optional(),
  name:           z.string().min(1).max(255),
  type:           z.enum(["folder", "file"]),
  body:           z.string().max(500_000).optional(),
  fileKey:        z.string().max(1024).optional(),
});
export type CreateDocumentBody = z.infer<typeof createDocumentBody>;

export const updateDocumentBody = z.object({
  name:    z.string().min(1).max(255).optional(),
  body:    z.string().max(500_000).optional(),
  fileKey: z.string().max(1024).optional(),
});
export type UpdateDocumentBody = z.infer<typeof updateDocumentBody>;

export const listDocumentsQuery = z.object({
  matterId:       z.string().uuid(),
  parentFolderId: z.string().uuid().optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuery>;

export const versionHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type VersionHistoryQuery = z.infer<typeof versionHistoryQuery>;
