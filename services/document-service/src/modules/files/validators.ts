import { z } from "zod";

export const uploadFileBody = z.object({
  name:       z.string().min(1).max(500),
  folderId:   z.string().uuid().optional(),
  mimeType:   z.string().max(128).optional(),
  sizeBytes:  z.number().int().nonnegative().optional(),
  tags:       z.array(z.string().max(64)).max(20).default([]),
  // Base64-encoded content (small files / metadata-only uploads)
  content:    z.string().optional(),
});
export type UploadFileBody = z.infer<typeof uploadFileBody>;

export const updateFileTagsBody = z.object({
  tags: z.array(z.string().max(64)).max(20),
});

export const moveFileBody = z.object({
  folderId: z.string().uuid().nullable(),
});
