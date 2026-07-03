import { z } from "zod";

export const createVersionBody = z.object({
  documentId: z.string().uuid(),
  s3Key: z.string().min(1).max(1024),
  sizeBytes: z.number().int().min(0).optional(),
  changeNote: z.string().max(2000).default(""),
});
export type CreateVersionBody = z.infer<typeof createVersionBody>;

export const restoreVersionBody = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  changeNote: z.string().max(2000).default("Restored from previous version"),
});
export type RestoreVersionBody = z.infer<typeof restoreVersionBody>;
