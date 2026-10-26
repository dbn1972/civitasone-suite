import { z } from "zod";

/** Types document-service's bulk-scan accepts (ALLOWED_UPLOAD_MIME). */
export const AFFIDAVIT_MIME = ["application/pdf", "image/tiff", "image/jpeg", "image/png"] as const;
export const MAX_AFFIDAVIT_BYTES = 20 * 1024 * 1024;

export const startAffidavitBody = z.object({
  fileName: z.string().trim().min(1).max(255)
    // eslint-disable-next-line no-control-regex
    .refine((n) => !/[\u0000-\u001f\u007f/\\]/.test(n), "file name has invalid characters"),
  mimeType: z.enum(AFFIDAVIT_MIME),
  sizeBytes: z.number().int().min(1).max(MAX_AFFIDAVIT_BYTES),
});
export type StartAffidavitBody = z.infer<typeof startAffidavitBody>;

export const caseParam = z.object({ id: z.string().uuid() });
export const attachmentParam = z.object({ id: z.string().uuid(), aid: z.string().uuid() });
