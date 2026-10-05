/**
 * Client-side zod schema for the per-tenant bulk-scan settings and scan profiles. It MIRRORS
 * services/document-service/src/modules/bulk-scan/validators.ts (the server stays the authority and re-validates):
 * same ranges, same cross-field rules, so the form tells the admin what the server would reject before submit.
 * Custom issue messages are i18n keys (bulkScan.settings.err.*), not English text.
 */
import { z } from "zod";

export const OCR_LANGS = ["eng", "hin", "ben", "tam", "tel", "mar", "guj", "kan", "mal", "pan", "ori", "urd", "asm"] as const;
export const OCR_PROVIDER_IDS = ["tesseract", "google_docai", "aws_textract", "azure_docint", "bhashini"] as const;
export const PREPROCESS_STEPS = ["rotate", "deskew", "grayscale", "contrast", "denoise", "binarize", "crop"] as const;
export const DUPLICATE_POLICIES = ["skip", "link", "keep"] as const;
export const FIELD_KINDS = [
  "date", "amount_inr", "reference_no", "file_no", "pan", "aadhaar", "ifsc", "phone", "email", "employee_no", "voucher_no", "account_no",
] as const;
export const PII_TYPES = ["aadhaar", "pan", "bank_account", "phone", "email"] as const;
export const PII_ACTIONS = ["mask", "redact", "flag"] as const;
export const LINK_TARGET_IDS = ["hr_employee", "finance_payment", "finance_voucher", "finance_bill", "eoffice_file"] as const;

export const TWO_DIGIT_YEAR_PIVOT_DEFAULT = 49;

export interface ChainEntry {
  id: string;
  timeoutMs: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const docTypeId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "err.docTypeId");
const ocrLang = z.enum(OCR_LANGS);
const providerId = z.enum(OCR_PROVIDER_IDS);
const piiAction = z.enum(PII_ACTIONS);

export const providerChainEntry = z.object({ id: providerId, timeoutMs: z.number().int().min(1_000).max(600_000) }).strict();

export const docTypeConfig = z.object({
  id: docTypeId,
  label: z.string().min(1).max(80),
  keywords: z.array(z.string().min(1).max(80)).max(50),
  requiredFields: z.array(z.enum(FIELD_KINDS)).max(12),
}).strict();

const uniq = <T>(a: readonly T[]): boolean => new Set(a).size === a.length;

export const settingsSchema = z.object({
  providerChain: z.array(providerChainEntry).min(1).max(5),
  languages: z.array(ocrLang).min(1).max(4),
  dpi: z.number().int().min(150).max(600),
  preprocessingSteps: z.array(z.enum(PREPROCESS_STEPS)).max(PREPROCESS_STEPS.length),
  reviewThreshold: z.number().min(0).max(1),
  bestOf: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1) }).strict(),
  classification: z.object({
    docTypes: z.array(docTypeConfig).min(1).max(40),
    uncertainBelow: z.number().min(0).max(1),
    /**
     * Classifier cross-check tuning (server defaults come from @civitasone/ocr and are NOT duplicated here: absent = server default).
     * A batch / profile preset type is trusted; the classifier only flags a DIFFERENT type picked with at least `uncertainMargin`.
     */
    uncertainMargin: z.number().min(0).max(1).optional(),
    minScore: z.number().min(0).max(1).optional(),
  }).strict(),
  pii: z.object({
    policy: z.object({ aadhaar: piiAction, pan: piiAction, bank_account: piiAction, phone: piiAction, email: piiAction }).strict(),
    reviewOnDetect: z.boolean(),
  }).strict(),
  malwareFailClosed: z.boolean(),
  duplicatePolicy: z.enum(DUPLICATE_POLICIES),
  limits: z.object({
    maxFileBytes: z.number().int().min(1024).max(500 * MB),
    maxFilesPerBatch: z.number().int().min(1).max(5_000),
    maxBatchBytes: z.number().int().min(1024).max(50 * GB),
  }).strict(),
  allowedLinkTargets: z.array(z.enum(LINK_TARGET_IDS)).max(LINK_TARGET_IDS.length),
  filingMakerChecker: z.boolean(),
  retentionDaysByType: z.record(docTypeId, z.number().int().min(1).max(36_500)),
  concurrency: z.number().int().min(1).max(8),
  /** 2-digit years <= pivot read as 20yy, otherwise 19yy. */
  twoDigitYearPivot: z.number().int().min(0).max(99),
  maxAttempts: z.number().int().min(1).max(10),
}).strict().superRefine((s, ctx) => {
  const issue = (path: (string | number)[], message: string): void => { ctx.addIssue({ code: z.ZodIssueCode.custom, path, message }); };
  if (!uniq(s.providerChain.map((p) => p.id))) issue(["providerChain"], "err.dupProvider");
  if (!uniq(s.languages)) issue(["languages"], "err.dupLanguage");
  if (!uniq(s.preprocessingSteps)) issue(["preprocessingSteps"], "err.dupStep");
  if (!uniq(s.allowedLinkTargets)) issue(["allowedLinkTargets"], "err.dupTarget");
  if (s.bestOf.enabled && s.providerChain.length < 2) issue(["bestOf", "enabled"], "err.bestOfNeedsTwo");
  if (s.dpi < 200 && s.languages.some((l) => l !== "eng")) issue(["dpi"], "err.indicDpi");
  const ids = s.classification.docTypes.map((d) => d.id);
  if (!uniq(ids)) issue(["classification", "docTypes"], "err.dupDocType");
  if (!ids.includes("other")) issue(["classification", "docTypes"], "err.otherRequired");
  s.classification.docTypes.forEach((d, i) => {
    if (!uniq(d.requiredFields)) issue(["classification", "docTypes", i, "requiredFields"], "err.dupRequiredField");
  });
  for (const k of Object.keys(s.retentionDaysByType)) {
    if (!ids.includes(k)) issue(["retentionDaysByType", k], "err.retentionUnknownType");
  }
});
export type BulkScanSettings = z.infer<typeof settingsSchema>;

export const profileConfigSchema = z.object({
  languages: z.array(ocrLang).min(1).max(4).optional(),
  dpi: z.number().int().min(150).max(600).optional(),
  preprocessingSteps: z.array(z.enum(PREPROCESS_STEPS)).max(PREPROCESS_STEPS.length).optional(),
  reviewThreshold: z.number().min(0).max(1).optional(),
  bestOf: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1) }).strict().optional(),
  providerChain: z.array(providerChainEntry).min(1).max(5).optional(),
  defaultDocType: docTypeId.optional(),
  classification: z.object({ uncertainMargin: z.number().min(0).max(1).optional(), minScore: z.number().min(0).max(1).optional() }).strict().optional(),
  linkDefaults: z.object({ target: z.enum(LINK_TARGET_IDS) }).strict().optional(),
}).strict().superRefine((p, ctx) => {
  if (p.providerChain && !uniq(p.providerChain.map((x) => x.id))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerChain"], message: "err.dupProvider" });
  if (p.languages && !uniq(p.languages)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["languages"], message: "err.dupLanguage" });
  if (p.bestOf?.enabled && (p.providerChain?.length ?? 2) < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bestOf", "enabled"], message: "err.bestOfNeedsTwo" });
  if (p.dpi !== undefined && p.dpi < 200 && (p.languages ?? []).some((l) => l !== "eng")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dpi"], message: "err.indicDpi" });
});
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

export const profileBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  config: profileConfigSchema,
}).strict();

/** PUT /settings body: `reason` is mandatory (3..500 chars) when the change turns malware fail-closed OFF. */
export const reasonSchema = z.string().trim().min(3).max(500);

// ── issue -> i18n ───────────────────────────────────────────────

export interface FieldIssue {
  /** dotted path, e.g. "limits.maxFileBytes" or "classification.docTypes.2.id" */
  path: string;
  /** i18n key under bulkScan.settings */
  key: string;
  params: Record<string, string | number>;
}

export function describeIssue(issue: z.ZodIssue): FieldIssue {
  const path = issue.path.join(".");
  switch (issue.code) {
    case z.ZodIssueCode.custom:
      return { path, key: issue.message.startsWith("err.") ? issue.message : "err.invalid", params: {} };
    case z.ZodIssueCode.too_small:
      if (issue.type === "array") return { path, key: "err.minItems", params: { min: Number(issue.minimum) } };
      if (issue.type === "string") return { path, key: "err.required", params: {} };
      return { path, key: "err.min", params: { min: Number(issue.minimum) } };
    case z.ZodIssueCode.too_big:
      if (issue.type === "array") return { path, key: "err.maxItems", params: { max: Number(issue.maximum) } };
      if (issue.type === "string") return { path, key: "err.maxLength", params: { max: Number(issue.maximum) } };
      return { path, key: "err.max", params: { max: Number(issue.maximum) } };
    case z.ZodIssueCode.invalid_string:
      return { path, key: issue.message.startsWith("err.") ? issue.message : "err.invalid", params: {} };
    case z.ZodIssueCode.invalid_type:
      return { path, key: issue.received === "undefined" || issue.received === "nan" ? "err.required" : "err.invalid", params: {} };
    default:
      return { path, key: "err.invalid", params: {} };
  }
}

export type SettingsValidation = { ok: true; data: BulkScanSettings } | { ok: false; issues: FieldIssue[] };

export function validateSettings(input: unknown): SettingsValidation {
  const r = settingsSchema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false, issues: r.error.issues.map(describeIssue) };
}

export type ProfileValidation = { ok: true; data: z.infer<typeof profileBodySchema> } | { ok: false; issues: FieldIssue[] };
export function validateProfile(input: unknown): ProfileValidation {
  const r = profileBodySchema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false, issues: r.error.issues.map(describeIssue) };
}

/** First issue at exactly `path` (or under it), for inline display. */
export function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((i) => i.path === path) ?? issues.find((i) => i.path.startsWith(`${path}.`));
}

/** Turning malware fail-closed OFF weakens the gate: it needs a reason and a super_admin second approver. */
export function isSensitiveChange(current: Pick<BulkScanSettings, "malwareFailClosed">, proposed: Pick<BulkScanSettings, "malwareFailClosed">): boolean {
  return current.malwareFailClosed && !proposed.malwareFailClosed;
}

/** Top-level keys that differ (values may be large; only the names are shown to the approver). */
export function changedKeys(current: Record<string, unknown>, proposed: Record<string, unknown>): string[] {
  return Object.keys(proposed).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(proposed[k]));
}

// ── unit conversion for the form ────────────────────────────────

export const bytesToMb = (b: number): number => Math.round((b / MB) * 100) / 100;
export const mbToBytes = (mb: number): number => Math.round(mb * MB);
export const ratioToPercent = (r: number): number => Math.round(r * 1000) / 10;
export const percentToRatio = (p: number): number => Math.round((p / 100) * 1000) / 1000;

/** Human help for the two-digit-year pivot: shows both readings of the boundary. */
export function pivotExamples(pivot: number): { low: string; high: string } {
  const p = Math.min(99, Math.max(0, Math.trunc(pivot)));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return { low: `${pad(p)} → ${2000 + p}`, high: p >= 99 ? "—" : `${pad(p + 1)} → ${1900 + p + 1}` };
}
