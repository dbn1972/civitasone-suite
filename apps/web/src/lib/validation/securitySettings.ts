import { z } from "zod";

/**
 * GAP-ADMIN-SETTINGS-03: client-side bounds for the Security settings section.
 * A wrong allow-list or a 0-minute timeout can lock out every user including
 * the admin, and `<input min/max>` is only a browser hint (the section has no
 * <form>; Save is an onClick), so the bounds are enforced here before any
 * request is sent. The server remains the authority.
 */

export const SESSION_TIMEOUT_MIN = { min: 5, max: 480 } as const;
export const MAX_LOGIN_ATTEMPTS = { min: 1, max: 20 } as const;
export const PASSWORD_MIN_LEN = { min: 8, max: 64 } as const;
export const IP_ALLOWLIST_MAX_LINES = 200;

const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;

function isIPv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => IPV4_OCTET.test(p) && Number(p) <= 255);
}

function isIPv6(s: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(s) || s.includes(":::")) return false;
  const doubleColon = s.split("::");
  if (doubleColon.length > 2) return false;
  const parseGroups = (part: string): string[] | null => (part === "" ? [] : part.split(":"));
  const head = parseGroups(doubleColon[0]!);
  const tail = doubleColon.length === 2 ? parseGroups(doubleColon[1]!) : [];
  if (head === null || tail === null) return false;
  const groups = [...head, ...tail];
  let width = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (g.includes(".")) {
      // An embedded IPv4 tail is only valid as the very last group.
      if (i !== groups.length - 1 || !isIPv4(g)) return false;
      width += 2;
    } else {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
      width += 1;
    }
  }
  return doubleColon.length === 2 ? width < 8 : width === 8;
}

/** True for `a.b.c.d/0-32` or an IPv6 address with `/0-128`. */
export function isValidCidr(value: string): boolean {
  const idx = value.indexOf("/");
  if (idx <= 0 || idx === value.length - 1) return false;
  const addr = value.slice(0, idx);
  const bitsText = value.slice(idx + 1);
  if (!/^\d{1,3}$/.test(bitsText)) return false;
  const bits = Number(bitsText);
  if (isIPv4(addr)) return bits >= 0 && bits <= 32;
  if (addr.includes(":")) return isIPv6(addr) && bits >= 0 && bits <= 128;
  return false;
}

/** Splits the textarea into trimmed non-empty lines. */
export function parseIpAllowlist(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

const intField = (label: string, range: { min: number; max: number }) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `Enter ${range.min}-${range.max}`)
    .transform(Number)
    .refine((n) => n >= range.min && n <= range.max, `Enter ${range.min}-${range.max}`)
    .describe(label);

export const securitySettingsSchema = z.object({
  sessionTimeoutMin: intField("Session timeout", SESSION_TIMEOUT_MIN),
  maxLoginAttempts: intField("Max login attempts", MAX_LOGIN_ATTEMPTS),
  passwordMinLen: intField("Minimum password length", PASSWORD_MIN_LEN),
  ipWhitelist: z.string().superRefine((text, ctx) => {
    const lines = parseIpAllowlist(text);
    if (lines.length > IP_ALLOWLIST_MAX_LINES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${IP_ALLOWLIST_MAX_LINES} ranges` });
      return;
    }
    const bad = lines.find((l) => !isValidCidr(l));
    if (bad !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${bad}" is not a valid CIDR range (e.g. 10.0.0.0/8)` });
    }
  }),
});

export type SecurityFieldErrors = Partial<Record<"sessionTimeoutMin" | "maxLoginAttempts" | "passwordMinLen" | "ipWhitelist", string>>;

/**
 * Validates only the fields the admin actually changed (string inputs), so an
 * untouched field is never sent and never blocks Save. Returns the parsed
 * payload (numbers parsed, allow-list normalised to one trimmed range per
 * line) or per-field messages.
 */
export function validateSecurityChanges(
  changed: Partial<Record<"sessionTimeoutMin" | "maxLoginAttempts" | "passwordMinLen" | "ipWhitelist", string>>,
): { ok: true; data: Record<string, number | string> } | { ok: false; errors: SecurityFieldErrors } {
  const errors: SecurityFieldErrors = {};
  const data: Record<string, number | string> = {};
  for (const key of Object.keys(changed) as (keyof typeof changed)[]) {
    const schema = securitySettingsSchema.shape[key];
    const result = schema.safeParse(changed[key] ?? "");
    if (!result.success) {
      errors[key] = result.error.issues[0]?.message ?? "Invalid value";
    } else {
      data[key] = key === "ipWhitelist" ? parseIpAllowlist(changed[key] ?? "").join("\n") : (result.data as number);
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data };
}
