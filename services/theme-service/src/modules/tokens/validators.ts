import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createTokenBody = z.object({
  name: z.string().min(1).max(128),
  value: z.string().min(1).max(512),
  category: z.string().min(1).max(64).optional(),
});
export type CreateTokenBody = z.infer<typeof createTokenBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const tokenViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  value: z.string(),
  category: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const tokensListSchema = paginatedSchema(tokenViewSchema);

export const upsertBrandBody = z.object({
  appName: z.string().min(1).max(128).optional(),
  tagline: z.string().max(256).nullable().optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  logoDarkUrl: z.string().url().max(2048).nullable().optional(),
  faviconUrl: z.string().url().max(2048).nullable().optional(),
  loginBgUrl: z.string().url().max(2048).nullable().optional(),
  footerText: z.string().max(512).nullable().optional(),
  poweredBy: z.string().max(128).nullable().optional(),
  colorPrimary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorPrimaryFg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorSecondary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorSurface: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorBorder: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorText: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorMuted: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorSuccess: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorWarning: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorError: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fontFamily: z.string().max(256).optional(),
  fontFamilyMono: z.string().max(256).optional(),
  sidebarStyle: z.enum(["default", "compact", "expanded"]).optional(),
  headerStyle: z.enum(["default", "minimal", "branded"]).optional(),
  borderRadius: z.string().max(32).optional(),
  customCss: z.string().max(16384).nullable().optional(),
});
export type UpsertBrandBody = z.infer<typeof upsertBrandBody>;

export const applyPresetBody = z.object({
  code: z.string().min(1).max(64),
});
export type ApplyPresetBody = z.infer<typeof applyPresetBody>;
