/** zod schemas for the review / link / download / search routes (route boundary AND consumers). */
import { z } from "zod";
import { linkTargetSchema } from "@civitasone/scan-link";
import { FIELD_KINDS } from "./validators.js";

const pageNo = z.number().int().min(1).max(5000);

export const reviewQueueQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  reason: z.string().trim().min(1).max(64).optional(),
});

export const editFields = z.object({
  expectedVersion: z.number().int().min(1),
  docType: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  fields: z.array(z.object({
    kind: z.enum(FIELD_KINDS),
    value: z.string().trim().min(1).max(500),
    pageNumber: pageNo.optional(),
  }).strict()).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  text: z.array(z.object({ pageNumber: pageNo, text: z.string().max(100_000) }).strict()).max(200).optional(),
});
export const editBody = editFields.strict().refine((b) => b.docType !== undefined || b.fields !== undefined || b.tags !== undefined || b.text !== undefined, {
  message: "nothing to edit",
});
export type EditBody = z.infer<typeof editBody>;

export const linkRefSchema = z.object({ target: linkTargetSchema, targetId: z.string().min(1).max(128) }).strict();

export const approveBody = z.object({ expectedVersion: z.number().int().min(1), link: linkRefSchema.optional() }).strict();
export type ApproveBody = z.infer<typeof approveBody>;

export const rejectBody = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(5).max(500) }).strict();
export type RejectBody = z.infer<typeof rejectBody>;

export const LINK_STATE_FILTERS = ["requested", "awaiting_approval", "linked", "flagged_mismatch", "rejected", "unlink_requested", "unlinked"] as const;
export const linksQuery = z.object({
  state: z.enum(LINK_STATE_FILTERS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const linkParam = z.object({ linkId: z.string().uuid() });
export const linkRejectBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const unlinkBody = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

export const lookupQuery = z.object({
  target: linkTargetSchema,
  q: z.string().trim().min(1).max(200),
  amountMinor: z.string().regex(/^\d{1,18}$/).optional(),
});

export const searchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  docType: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const VARIANTS = ["original", "searchable_pdf", "text", "json"] as const;
export type DownloadVariant = (typeof VARIANTS)[number];
export const downloadQuery = z.object({ variant: z.enum(VARIANTS).default("original") });
export const documentParam = z.object({ documentId: z.string().uuid() });
export const pageParams = z.object({ documentId: z.string().uuid(), n: z.coerce.number().int().min(1).max(5000) });
