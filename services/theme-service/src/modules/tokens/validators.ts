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

/**
 * Uploaded tenant logo, carried as a base64 `data:` URL in its own field
 * (`logoDataUrl`); `logoUrl` stays for external https URLs only.
 *
 * Raster formats only (PNG / JPEG / WebP). SVG is deliberately NOT accepted:
 * the service has no SVG sanitiser, and an SVG can carry script. The decoded
 * size cap and the magic-byte check are enforced HERE, server-side, so a
 * client that skips the browser checks cannot store an oversize or mislabelled
 * payload.
 */
export const MAX_LOGO_BYTES = 200 * 1024;
// base64 expands 3 bytes -> 4 chars; this bounds the string before we decode it.
const MAX_LOGO_DATA_URL_CHARS = Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 64;
const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function hasMagic(kind: string, b: Buffer): boolean {
  if (kind === "png") return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === "jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
}

export const logoDataUrlSchema = z.string().superRefine((value, ctx) => {
  if (value.length > MAX_LOGO_DATA_URL_CHARS) {
    ctx.addIssue({ code: "custom", message: "Logo must be 200KB or smaller." });
    return;
  }
  const m = LOGO_DATA_URL_RE.exec(value);
  if (!m) {
    ctx.addIssue({ code: "custom", message: "Logo must be a PNG, JPEG or WebP image (SVG is not supported)." });
    return;
  }
  const bytes = Buffer.from(m[2]!, "base64");
  if (bytes.length > MAX_LOGO_BYTES) {
    ctx.addIssue({ code: "custom", message: "Logo must be 200KB or smaller." });
    return;
  }
  if (!hasMagic(m[1]!, bytes)) {
    ctx.addIssue({ code: "custom", message: "Logo file content does not match its declared image type." });
  }
});

export const upsertBrandBody = z.object({
  appName: z.string().min(1).max(128).optional(),
  tagline: z.string().max(256).nullable().optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  logoDataUrl: logoDataUrlSchema.nullable().optional(),
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
