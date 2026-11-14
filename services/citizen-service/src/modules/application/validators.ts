import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });
export const docIdParam = z.object({ id: z.string().uuid(), docId: z.string().uuid() });

/** P0-3: citizenId is optional in input — resolved/constrained from the actor. */
export const citizenIdQuery = z.object({ citizenId: z.string().uuid().optional() });

export const submitApplicationBody = z.object({
  citizenId: z.string().uuid().optional(),
  serviceId: z.string().uuid(),
  // P1-7: capped + sanitised free text.
  serviceType: safeText({ max: 128 }),
  documentTypes: z.array(safeText({ max: 64 })).max(50).default([]),
});
export type SubmitApplicationBody = z.infer<typeof submitApplicationBody>;

export const statusUpdateBody = z.object({
  status: z.enum(["submitted", "under_review", "pending_docs", "approved", "rejected", "issued"]),
  note:   safeText({ max: 2000, multiline: true }).optional(),
});
export type StatusUpdateBody = z.infer<typeof statusUpdateBody>;

export const docUploadBody = z.object({
  docType: safeText({ max: 64 }),
  // File metadata: validated against the citizen document limits (type + size) before a presigned PUT
  // is minted. Optional at the schema level so ownership (404) is decided before a 400 FILE_REQUIRED.
  filename: safeText({ max: 255 }).optional(),
  contentType: z.string().max(100).optional(),
  sizeBytes: z.number().int().positive().optional(),
});
export type DocUploadBody = z.infer<typeof docUploadBody>;
