import { z } from "zod";

export const policyBody = z.object({
  assetId:             z.string().uuid(),
  policyNo:            z.string().min(1).max(64),
  insurer:             z.string().min(1).max(256),
  coverageMinor:       z.number().int().nonnegative(),
  premiumMinor:        z.number().int().nonnegative(),
  currency:            z.string().length(3).default("INR"),
  startDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  renewalReminderDays: z.number().int().positive().default(30),
});
export type PolicyBody = z.infer<typeof policyBody>;

// GAP-ASSETS-INSURANCE-CLAIMS-06: an attachment is a reference to a file already uploaded through the admin uploads
// presign flow: uploads/<tenant>/<category>/<uploader>/<uuid>.<ext>. The command re-checks that the tenant AND the
// uploader segments are the caller's own and that the object exists in storage, so a key cannot be forged or lifted
// from another user or tenant.
export const MAX_CLAIM_ATTACHMENTS = 5;
export const claimAttachment = z.object({
  key:      z.string().max(300).regex(/^uploads\/[0-9a-f-]{36}\/(attachment|document|photo)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/),
  fileName: z.string().trim().min(1).max(255),
  size:     z.number().int().positive().max(20 * 1024 * 1024),
  mimeType: z.string().trim().min(1).max(100),
});

export const claimBody = z.object({
  policyId:        z.string().uuid(),
  assetId:         z.string().uuid(),
  claimDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  claimAmountMinor:z.number().int().nonnegative(),
  currency:        z.string().length(3).default("INR"),
  notes:           z.string().max(1000).optional(),
  attachments:     z.array(claimAttachment).max(MAX_CLAIM_ATTACHMENTS).default([]),
});
export type ClaimBody = z.infer<typeof claimBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const policyQueryParams = z.object({
  assetId: z.string().uuid().optional(),
  status:  z.string().optional(),
  limit:   z.coerce.number().int().positive().max(200).default(50),
  offset:  z.coerce.number().int().nonnegative().default(0),
});

export const claimQueryParams = z.object({
  policyId: z.string().uuid().optional(),
  status:   z.string().optional(),
  limit:    z.coerce.number().int().positive().max(200).default(50),
  offset:   z.coerce.number().int().nonnegative().default(0),
});
