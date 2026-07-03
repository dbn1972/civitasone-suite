import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be hex color e.g. #1e40af");

export const upsertBrandingBody = z.object({
  logoS3Key: z.string().max(512).optional(),
  faviconS3Key: z.string().max(512).optional(),
  appName: z.string().min(1).max(128).optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  footerText: z.string().max(500).optional(),
});
export type UpsertBrandingBody = z.infer<typeof upsertBrandingBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const brandingViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  logoS3Key: z.string().nullable(),
  faviconS3Key: z.string().nullable(),
  appName: z.string(),
  primaryColor: z.string(),
  accentColor: z.string(),
  footerText: z.string().nullable(),
  version: z.number().int(),
});

export const brandingListSchema = paginatedSchema(brandingViewSchema);
