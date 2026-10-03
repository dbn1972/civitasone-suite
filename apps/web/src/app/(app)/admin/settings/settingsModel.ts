import type { AdminSettings } from "@/app/_data/loaders";

/**
 * GAP-ADMIN-SETTINGS-01/-05: pure helpers for the System Settings form.
 * Form inputs are strings (an emptied number field is "empty", never 0).
 */
export type GeneralForm = { orgName: string; timezone: string; currency: string; dateFormat: string; fiscalYearStart: string };
export type EmailForm = { smtpHost: string; smtpPort: string; smtpUser: string; smtpPass: string; fromName: string; fromEmail: string; useTls: boolean };
export type SecurityForm = { sessionTimeoutMin: string; maxLoginAttempts: string; passwordMinLen: string; mfaRequired: boolean; ipWhitelist: string };
export type IntegrationsForm = { pfmsUrl: string; nicGatewayUrl: string; digiLockerEnabled: boolean; umangEnabled: boolean };

const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const flag = (v: unknown): boolean => v === true;

export function generalForm(s: AdminSettings): GeneralForm {
  const v = s.general.values;
  return { orgName: text(v.orgName), timezone: text(v.timezone), currency: text(v.currency), dateFormat: text(v.dateFormat), fiscalYearStart: text(v.fiscalYearStart) };
}
export function emailForm(s: AdminSettings): EmailForm {
  const v = s.email.values;
  // smtpPass is write-only: the form never holds a stored password.
  return { smtpHost: text(v.smtpHost), smtpPort: text(v.smtpPort), smtpUser: text(v.smtpUser), smtpPass: "", fromName: text(v.fromName), fromEmail: text(v.fromEmail), useTls: flag(v.useTls) };
}
export function securityForm(s: AdminSettings): SecurityForm {
  const v = s.security.values;
  const ips = Array.isArray(v.ipWhitelist) ? v.ipWhitelist.map(String).join("\n") : text(v.ipWhitelist);
  return { sessionTimeoutMin: text(v.sessionTimeoutMin), maxLoginAttempts: text(v.maxLoginAttempts), passwordMinLen: text(v.passwordMinLen), mfaRequired: flag(v.mfaRequired), ipWhitelist: ips };
}
export function integrationsForm(s: AdminSettings): IntegrationsForm {
  const v = s.integrations.values;
  return { pfmsUrl: text(v.pfmsUrl), nicGatewayUrl: text(v.nicGatewayUrl), digiLockerEnabled: flag(v.digiLockerEnabled), umangEnabled: flag(v.umangEnabled) };
}

/** The fields whose value differs from what was loaded; a typed SMTP password always counts, an empty one never does. */
export function changedFields<T extends Record<string, unknown>>(baseline: T, values: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(values) as (keyof T)[]) {
    if (k === "smtpPass") {
      if (values[k] !== "" && values[k] !== undefined) out[k] = values[k];
      continue;
    }
    if (values[k] !== baseline[k]) out[k] = values[k];
  }
  return out;
}

/** A logo travels inside one queue message, so it is capped well under the 256 KB message limit (admin-service LOGO_HARD_MAX_BYTES). */
export const LOGO_MAX_BYTES = 150_000;
export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;

export type LogoProblem = "type" | "size" | "empty";
export function logoProblem(file: { type: string; size: number }): LogoProblem | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > LOGO_MAX_BYTES) return "size";
  if (file.size === 0) return "empty";
  return null;
}
