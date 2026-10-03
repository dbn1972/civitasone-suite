/** zod validators for the tenant-settings commands (GAP-ADMIN-SETTINGS-01/-05/-06). */
import { isIP } from "node:net";
import { z } from "zod";

export const SETTINGS_SECTIONS = ["general", "email", "security", "integrations"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const sectionParam = z.object({ section: z.enum(SETTINGS_SECTIONS) });

/** A logo is carried inside a queue command (SQS caps a message at 256 KB), so the default cap is well below that. */
export const LOGO_HARD_MAX_BYTES = 150_000;
export function logoMaxBytes(): number {
  const raw = Number(process.env.ADMIN_LOGO_MAX_BYTES);
  return Number.isInteger(raw) && raw > 0 ? Math.min(raw, LOGO_HARD_MAX_BYTES) : LOGO_HARD_MAX_BYTES;
}

/** `a.b.c.d/0-32` or an IPv6 address with `/0-128`. */
export function isValidCidr(value: string): boolean {
  const idx = value.indexOf("/");
  if (idx <= 0 || idx === value.length - 1) return false;
  const addr = value.slice(0, idx);
  const bitsText = value.slice(idx + 1);
  if (!/^\d{1,3}$/.test(bitsText)) return false;
  const bits = Number(bitsText);
  const family = isIP(addr);
  if (family === 4) return bits <= 32;
  if (family === 6) return bits <= 128;
  return false;
}

const ipAllowlist = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/\r?\n/)).map((l) => l.trim()).filter((l) => l.length > 0))
  .pipe(
    z.array(z.string().refine(isValidCidr, "must be a CIDR range such as 10.0.0.0/8")).max(200, "at most 200 ranges"),
  );

const emptyOr = <T extends z.ZodTypeAny>(inner: T) => z.union([z.literal(""), inner]);
const httpsUrl = z
  .string()
  .max(500)
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an https:// URL");

export const generalPatch = z
  .object({
    orgName: z.string().trim().min(1).max(200),
    timezone: z.enum(["Asia/Kolkata", "UTC"]),
    currency: z.enum(["INR", "USD"]),
    dateFormat: z.enum(["dd/MM/yyyy", "yyyy-MM-dd"]),
    fiscalYearStart: z.string().regex(/^(0[1-9]|1[0-2])$/, "must be a month 01-12"),
  })
  .partial()
  .strict();

export const emailPatch = z
  .object({
    smtpHost: emptyOr(z.string().trim().max(253).regex(/^[A-Za-z0-9.-]+$/, "must be a host name")),
    smtpPort: z.coerce.number().int().min(1).max(65535),
    smtpUser: z.string().trim().max(254),
    /** Write-only: sealed server-side, never returned by any read. */
    smtpPass: z.string().min(1).max(256),
    fromName: z.string().trim().max(200),
    fromEmail: emptyOr(z.string().trim().email().max(254)),
    useTls: z.boolean(),
  })
  .partial()
  .strict();

export const securityPatch = z
  .object({
    sessionTimeoutMin: z.coerce.number().int().min(5).max(480),
    maxLoginAttempts: z.coerce.number().int().min(1).max(20),
    passwordMinLen: z.coerce.number().int().min(8).max(64),
    mfaRequired: z.boolean(),
    ipWhitelist: ipAllowlist,
  })
  .partial()
  .strict();

export const integrationsPatch = z
  .object({
    pfmsUrl: emptyOr(httpsUrl),
    nicGatewayUrl: emptyOr(httpsUrl),
    digiLockerEnabled: z.boolean(),
    umangEnabled: z.boolean(),
  })
  .partial()
  .strict();

export const PATCH_SCHEMAS = {
  general: generalPatch,
  email: emailPatch,
  security: securityPatch,
  integrations: integrationsPatch,
} as const;

export const emailTestBody = z.object({ recipient: z.string().trim().email().max(254) }).strict();

export const logoBody = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg"]),
    /** base64 of the file bytes (no data: prefix). */
    dataBase64: z.string().min(8).max(Math.ceil((LOGO_HARD_MAX_BYTES * 4) / 3) + 8),
  })
  .strict();
export type LogoBody = z.infer<typeof logoBody>;

/** Returns the decoded bytes when `b64` really is a PNG/JPEG within the size cap, else a reason. */
export function decodeLogo(contentType: "image/png" | "image/jpeg", b64: string): { ok: true; bytes: Buffer } | { ok: false; reason: string } {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, reason: "dataBase64 is not valid base64" };
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return { ok: false, reason: "the image is empty" };
  if (bytes.length > logoMaxBytes()) return { ok: false, reason: `the image is larger than ${logoMaxBytes()} bytes` };
  const isPng = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png" && !isPng) return { ok: false, reason: "the file is not a PNG image" };
  if (contentType === "image/jpeg" && !isJpeg) return { ok: false, reason: "the file is not a JPEG image" };
  return { ok: true, bytes };
}
