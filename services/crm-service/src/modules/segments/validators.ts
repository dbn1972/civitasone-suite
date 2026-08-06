/**
 * zod validators for the segment taxonomy (G5) — applied at every route boundary.
 *
 * Channel codes are validated against `LEAD_CHANNELS`, the vocabulary the inbound
 * lead-capture route already uses, rather than a second list local to this module.
 */
import { z } from "zod";
import { LEAD_CHANNELS } from "../leads/channels.js";
import { SEGMENT_CODE_PATTERN, PRODUCT_CODE_PATTERN, SEGMENT_ERROR_CODES, duplicateProducts } from "./domain.js";
import { SEGMENT_GOVERNANCES } from "./schema.js";

const segmentCode = z.string().regex(SEGMENT_CODE_PATTERN, "segmentCode must be 2–64 chars of [A-Za-z0-9_-]");

/**
 * Ordered product codes. Duplicates are rejected: with duplicates the "order
 * expresses priority" contract would be ambiguous about which position wins.
 */
const priorityProducts = z
  .array(z.string().regex(PRODUCT_CODE_PATTERN, "product code must be 1–64 chars of [A-Za-z0-9_.-]"))
  .max(50)
  .superRefine((products, ctx) => {
    const dupes = duplicateProducts(products);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${SEGMENT_ERROR_CODES.duplicateProduct}: ${dupes.join(", ")}`,
      });
    }
  });

/** Same closed set as the inbound lead channel enum; duplicates rejected for the same reason. */
const primaryChannels = z
  .array(z.enum(LEAD_CHANNELS))
  .max(LEAD_CHANNELS.length)
  .superRefine((channels, ctx) => {
    if (new Set(channels).size !== channels.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "primaryChannels must not repeat a channel" });
    }
  });

export const createSegmentBody = z.object({
  segmentCode,
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  /**
   * Present so a deployment's seeding tool can install its reference catalogue through
   * the same command path. Defaults to `tenant`: a segment created by an ordinary
   * admin request is the tenant's own, never platform reference data.
   */
  governance: z.enum(SEGMENT_GOVERNANCES).default("tenant"),
  priorityProducts: priorityProducts.default([]),
  primaryChannels: primaryChannels.default([]),
});
export type CreateSegmentBody = z.infer<typeof createSegmentBody>;

export const updateSegmentBody = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    priorityProducts: priorityProducts.optional(),
    primaryChannels: primaryChannels.optional(),
    /** Optimistic locking — the version the caller believes it is amending. */
    version: z.number().int().min(1),
  })
  .refine(
    (b) =>
      b.displayName !== undefined ||
      b.description !== undefined ||
      b.priorityProducts !== undefined ||
      b.primaryChannels !== undefined,
    { message: "at least one mutable field is required" },
  );
export type UpdateSegmentBody = z.infer<typeof updateSegmentBody>;

export const segmentCodeParam = z.object({ segmentCode });

export const listSegmentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(["draft", "published", "deprecated"]).optional(),
  governance: z.enum(SEGMENT_GOVERNANCES).optional(),
});
export type ListSegmentsQuery = z.infer<typeof listSegmentsQuery>;

export const segmentSettingsBody = z.object({
  enforceSegmentCatalogue: z.boolean(),
});
export type SegmentSettingsBody = z.infer<typeof segmentSettingsBody>;

export const segmentViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  segmentCode: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  governance: z.enum(SEGMENT_GOVERNANCES),
  priorityProducts: z.array(z.string()),
  primaryChannels: z.array(z.string()),
  status: z.enum(["draft", "published", "deprecated"]),
  versionNumber: z.number().int(),
  publishedAt: z.string().nullable(),
  deprecatedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Standard list envelope: { data, meta: { page, pageSize, total } }. */
export const segmentsListSchema = z.object({
  data: z.array(segmentViewSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

/** The stable eligibility contract consumed by recommendation-service. */
export const eligibilityViewSchema = z.object({
  segmentCode: z.string(),
  displayName: z.string(),
  status: z.enum(["draft", "published", "deprecated"]),
  versionNumber: z.number().int(),
  priorityProducts: z.array(z.string()),
  primaryChannels: z.array(z.string()),
  publishedAt: z.string().nullable(),
});

export const eligibilityResponseSchema = z.object({ data: eligibilityViewSchema });
