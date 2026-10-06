import { z } from "zod";

// GAP-DOCUMENTS-NEW-03: executable/script extensions a clerk must never be able
// to register as an official document record. Mirrored client-side in the web
// upload form (documents/new/UploadDocumentForm.tsx); the server stays
// authoritative — a crafted request bypassing the UI is still rejected here.
const BLOCKED_FILE_EXTENSIONS = ["exe", "bat", "cmd", "com", "msi", "scr", "js", "sh", "ps1"];

function hasBlockedExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return false;
  return BLOCKED_FILE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

export const uploadFileBody = z.object({
  name:       z.string().min(1).max(500).refine((n) => !hasBlockedExtension(n), {
    message: "file type is not allowed",
  }),
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
