import { z } from "zod";
import { safeExternalUrl } from "@/lib/url";

/**
 * Boundary validation for the New Account form (GAP-CRM-ACCOUNTS-04). The
 * create command is queue-backed (202), so the new row is invisible until the
 * consumer runs — catching obviously-bad input client-side avoids a submit
 * that can only fail server-side after a round trip.
 *
 * - name: trimmed, 2–200 chars (the backend createAccount accepts up to 200).
 * - industry: optional, trimmed, ≤ 120 chars.
 * - website: optional; normalised to an absolute http(s) URL (a bare domain
 *   gets `https://` prepended rather than being rejected — see
 *   GAP-CRM-ACCOUNTS-04 risk note). `javascript:` and other schemes are
 *   rejected via safeExternalUrl.
 * - parentId: optional opaque id.
 */
export type NewAccountMessageKey = "nameRequired" | "nameTooLong" | "industryTooLong" | "websiteInvalid";

/** English defaults; the form passes a next-intl-backed translator instead. */
const DEFAULT_MESSAGES: Record<NewAccountMessageKey, string> = {
  nameRequired: "Enter an account name (at least 2 characters).",
  nameTooLong: "Account name is too long (max 200 characters).",
  industryTooLong: "Industry is too long (max 120 characters).",
  websiteInvalid: "Enter a valid web address (for example https://example.gov.in).",
};

export type NewAccountTranslator = (key: NewAccountMessageKey) => string;

export function buildNewAccountSchema(m: NewAccountTranslator = (k) => DEFAULT_MESSAGES[k]) {
  return z.object({
  name: z.string().trim().min(2, m("nameRequired")).max(200, m("nameTooLong")),
  industry: z.string().trim().max(120, m("industryTooLong")).optional().or(z.literal("")),
  website: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine((v) => v === undefined || safeExternalUrl(v) !== null, {
      message: m("websiteInvalid"),
    })
    .transform((v) => (v === undefined ? undefined : (safeExternalUrl(v) ?? undefined))),
  parentId: z.string().trim().optional().or(z.literal("")),
  });
}

export const newAccountSchema = buildNewAccountSchema();

export type NewAccountInput = z.infer<typeof newAccountSchema>;

/** Field-keyed error messages, or null when the input is valid. */
export function validateNewAccount(input: {
  name: string;
  industry: string;
  website: string;
  parentId: string;
}, translate?: NewAccountTranslator): { ok: true; value: NewAccountInput } | { ok: false; errors: Partial<Record<keyof NewAccountInput, string>> } {
  const parsed = (translate ? buildNewAccountSchema(translate) : newAccountSchema).safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Partial<Record<keyof NewAccountInput, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof NewAccountInput;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
