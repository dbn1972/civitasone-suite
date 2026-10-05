import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const lookupQuery = z
  .object({
    fileNo: z.string().trim().min(1).max(100).optional(),
    subject: z.string().trim().min(1).max(300).optional(),
  })
  .refine((q) => q.fileNo !== undefined || q.subject !== undefined, {
    message: "fileNo or subject is required",
  });

export const clearanceQuery = z.object({
  fileId: z.string().uuid(),
  userId: z.string().uuid(),
  roles: z.string().max(1000).default("").transform((v) => v.split(",").map((r) => r.trim()).filter(Boolean).slice(0, 30)),
});

export const listScannedQuery = z.object({
  state: z.enum(["linked", "unlinked", "all"]).default("linked"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
