/**
 * zod schemas for the bulk-scan module: tenant settings (+ cross-field rules), scan profiles and all
 * request bodies. Used at the route boundary AND again by consumers/readers (defence in depth).
 */
import { z } from "zod";
import { LINK_TARGETS, SCAN_DOC_TYPES, linkTargetSchema } from "@civitasone/scan-link";
import { OCR_LANGS, OCR_PROVIDER_IDS, DEFAULT_CLASSIFIER_CONFIG, type FieldKind, type OcrLang, type OcrProviderId, type PiiType } from "./ocr-contract.js";

// ── vocabulary ──────────────────────────────────────────────────

export const ALLOWED_UPLOAD_MIME = ["application/pdf", "image/tiff", "image/jpeg", "image/png"] as const;
export type AllowedMime = (typeof ALLOWED_UPLOAD_MIME)[number];

export const PREPROCESS_STEPS = ["rotate", "deskew", "grayscale", "contrast", "denoise", "binarize", "crop"] as const;
export type PreprocessStep = (typeof PREPROCESS_STEPS)[number];

export const DUPLICATE_POLICIES = ["skip", "link", "keep"] as const;
export type DuplicatePolicy = (typeof DUPLICATE_POLICIES)[number];

export const FIELD_KINDS = [
  "date", "amount_inr", "reference_no", "file_no", "pan", "aadhaar", "ifsc",
  "phone", "email", "employee_no", "voucher_no", "account_no",
] as const satisfies readonly FieldKind[];

export const PII_TYPES = ["aadhaar", "pan", "bank_account", "phone", "email"] as const satisfies readonly PiiType[];

const docTypeId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "doc type id: lowercase letters, digits, underscore");
const ocrLang = z.enum(OCR_LANGS as unknown as [OcrLang, ...OcrLang[]]);
const ocrProviderId = z.enum(OCR_PROVIDER_IDS as unknown as [OcrProviderId, ...OcrProviderId[]]);
const piiAction = z.enum(["mask", "redact", "flag"]);

// ── settings ────────────────────────────────────────────────────

export const providerChainEntry = z.object({
  id: ocrProviderId,
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
}).strict();

export const docTypeConfig = z.object({
  id: docTypeId,
  label: z.string().min(1).max(80),
  /** Case-insensitive keywords (any script) the rule-based classifier looks for. */
  keywords: z.array(z.string().min(1).max(80)).max(50).default([]),
  /** Field kinds that must be extracted, else the file goes to review. */
  requiredFields: z.array(z.enum(FIELD_KINDS)).max(12).default([]),
}).strict();

export const piiPolicySchema = z.object({
  aadhaar: piiAction, pan: piiAction, bank_account: piiAction, phone: piiAction, email: piiAction,
}).strict();

const DEFAULT_KEYWORDS: Record<(typeof SCAN_DOC_TYPES)[number], { label: string; keywords: string[]; requiredFields: FieldKind[] }> = {
  service_book:   { label: "Service book", keywords: ["service book", "सेवा पुस्तिका", "service record"], requiredFields: [] },
  pay_slip:       { label: "Pay slip", keywords: ["pay slip", "payslip", "salary slip", "वेतन पर्ची", "net pay"], requiredFields: [] },
  bill_voucher:   { label: "Bill / voucher", keywords: ["voucher", "invoice", "bill no", "tax invoice", "वाउचर"], requiredFields: ["amount_inr"] },
  sanction_order: { label: "Sanction order", keywords: ["sanction", "sanctioned", "स्वीकृति"], requiredFields: [] },
  office_order:   { label: "Office order", keywords: ["office order", "कार्यालय आदेश", "office memorandum"], requiredFields: [] },
  letter:         { label: "Letter", keywords: ["dear sir", "subject:", "पत्र", "yours faithfully"], requiredFields: [] },
  id_proof:       { label: "ID proof", keywords: ["aadhaar", "आधार", "permanent account number", "election commission"], requiredFields: [] },
  certificate:    { label: "Certificate", keywords: ["certificate", "certified that", "प्रमाण पत्र"], requiredFields: [] },
  other:          { label: "Other", keywords: [], requiredFields: [] },
};

export const DEFAULT_DOC_TYPES = SCAN_DOC_TYPES.map((id) => ({ id, ...DEFAULT_KEYWORDS[id] }));

const uniq = <T>(a: readonly T[]): boolean => new Set(a).size === a.length;

/**
 * The full per-tenant settings document. Every field has a SAFE DEFAULT (see DEFAULT_SETTINGS in
 * settings.ts) so `settingsSchema.parse({})` is the platform default.
 */
export const settingsSchema = z.object({
  providerChain: z.array(providerChainEntry).min(1).max(5).default([{ id: "tesseract", timeoutMs: 120_000 }]),
  languages: z.array(ocrLang).min(1).max(4).default(["eng", "hin"]),
  dpi: z.number().int().min(150).max(600).default(300),
  preprocessingSteps: z.array(z.enum(PREPROCESS_STEPS)).max(PREPROCESS_STEPS.length).default(["rotate", "deskew", "grayscale", "contrast"]),
  reviewThreshold: z.number().min(0).max(1).default(0.8),
  bestOf: z.object({
    enabled: z.boolean().default(false),
    /** Below this per-page confidence the next provider in the chain is also tried. */
    threshold: z.number().min(0).max(1).default(0.7),
  }).strict().default({}),
  classification: z.object({
    docTypes: z.array(docTypeConfig).min(1).max(40).default(DEFAULT_DOC_TYPES),
    /** Classifier confidence below this => uncertain => review. */
    uncertainBelow: z.number().min(0).max(1).default(0.5),
    /** Relative lead (top - other)/top the classifier needs over another type to count as a confident pick. Default from @civitasone/ocr. */
    uncertainMargin: z.number().min(0).max(1).default(DEFAULT_CLASSIFIER_CONFIG.uncertainMargin),
    /** Minimum classifier confidence (0..1) for a pick to count as a confident disagreement with an operator-preset doc type. Default from @civitasone/ocr (minConfidence). */
    minScore: z.number().min(0).max(1).default(DEFAULT_CLASSIFIER_CONFIG.minConfidence),
  }).strict().default({}),
  pii: z.object({
    policy: piiPolicySchema.default({ aadhaar: "mask", pan: "flag", bank_account: "flag", phone: "flag", email: "flag" }),
    /** Any detected PII sends the file to human review. */
    reviewOnDetect: z.boolean().default(false),
  }).strict().default({}),
  /** FAIL-CLOSED malware scanning (scanner outage => scan_pending, never processed unscanned). */
  malwareFailClosed: z.boolean().default(true),
  duplicatePolicy: z.enum(DUPLICATE_POLICIES).default("skip"),
  limits: z.object({
    maxFileBytes: z.number().int().min(1024).max(500 * 1024 * 1024).default(50 * 1024 * 1024),
    maxFilesPerBatch: z.number().int().min(1).max(5_000).default(500),
    maxBatchBytes: z.number().int().min(1024).max(50 * 1024 * 1024 * 1024).default(5 * 1024 * 1024 * 1024),
  }).strict().default({}),
  allowedLinkTargets: z.array(linkTargetSchema).max(LINK_TARGETS.length).default([...LINK_TARGETS]),
  /** Filing into a linked HR/Finance/eOffice record needs a second person (filer != approver). */
  filingMakerChecker: z.boolean().default(true),
  /** doc type id -> retention days (absent = no automatic expiry). */
  retentionDaysByType: z.record(docTypeId, z.number().int().min(1).max(36_500)).default({}),
  /**
   * Days after which the original, derivatives and quarantine copy of a NON-filed terminal file (skipped_duplicate,
   * skipped, failed, cancelled, quarantined) are deleted from the object store. file_events are kept. Filed documents
   * follow retentionDaysByType instead.
   */
  nonFiledRetentionDays: z.number().int().min(1).max(3_650).default(30),
  concurrency: z.number().int().min(1).max(8).default(2),
  /** 2-digit years <= pivot read as 20yy, otherwise 19yy (e.g. dates on old service-book pages). Passed to field extraction. */
  twoDigitYearPivot: z.number().int().min(0).max(99).default(49),
  /** Retry budget for any pipeline stage before dead-lettering. */
  maxAttempts: z.number().int().min(1).max(10).default(5),
}).strict().superRefine((s, ctx) => {
  const issue = (path: (string | number)[], message: string): void => { ctx.addIssue({ code: z.ZodIssueCode.custom, path, message }); };
  if (!uniq(s.providerChain.map((p) => p.id))) issue(["providerChain"], "duplicate provider in chain");
  if (!uniq(s.languages)) issue(["languages"], "duplicate language");
  if (!uniq(s.preprocessingSteps)) issue(["preprocessingSteps"], "duplicate preprocessing step");
  if (!uniq(s.allowedLinkTargets)) issue(["allowedLinkTargets"], "duplicate link target");
  if (s.bestOf.enabled && s.providerChain.length < 2) issue(["bestOf", "enabled"], "best-of needs at least two providers in the chain");
  if (s.dpi < 200 && s.languages.some((l) => l !== "eng")) {
    issue(["dpi"], "Indic scripts need dpi >= 200 for usable accuracy");
  }
  const ids = s.classification.docTypes.map((d) => d.id);
  if (!uniq(ids)) issue(["classification", "docTypes"], "duplicate doc type id");
  if (!ids.includes("other")) issue(["classification", "docTypes"], "a fallback doc type with id 'other' is required");
  s.classification.docTypes.forEach((d, i) => {
    if (!uniq(d.requiredFields)) issue(["classification", "docTypes", i, "requiredFields"], "duplicate required field");
  });
  for (const k of Object.keys(s.retentionDaysByType)) {
    if (!ids.includes(k)) issue(["retentionDaysByType", k], "retention set for unknown doc type " + k);
  }
});
export type BulkScanSettings = z.infer<typeof settingsSchema>;

// ── profiles (named presets layered over the tenant settings) ───

export const profileConfigSchema = z.object({
  languages: z.array(ocrLang).min(1).max(4).optional(),
  dpi: z.number().int().min(150).max(600).optional(),
  preprocessingSteps: z.array(z.enum(PREPROCESS_STEPS)).max(PREPROCESS_STEPS.length).optional(),
  reviewThreshold: z.number().min(0).max(1).optional(),
  bestOf: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1) }).strict().optional(),
  providerChain: z.array(providerChainEntry).min(1).max(5).optional(),
  defaultDocType: docTypeId.optional(),
  classification: z.object({ uncertainMargin: z.number().min(0).max(1).optional(), minScore: z.number().min(0).max(1).optional() }).strict().optional(),
  linkDefaults: z.object({ target: linkTargetSchema }).strict().optional(),
}).strict();
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

export const createProfileBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  config: profileConfigSchema,
  /** Required when the profile overrides a sensitive field (the request then needs a second approver). */
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
export type CreateProfileBody = z.infer<typeof createProfileBody>;

export const updateProfileBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  config: profileConfigSchema.optional(),
  /** optimistic concurrency */
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
export type UpdateProfileBody = z.infer<typeof updateProfileBody>;
export const deleteProfileQuery = z.object({ reason: z.string().trim().min(3).max(500).optional() });

/** A queued profile change awaiting a second approver (stored in settings_change_requests.profile_change). */
export const profileChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), name: z.string().trim().min(1).max(120), description: z.string().max(500).nullable().optional(), config: profileConfigSchema }).strict(),
  z.object({ op: z.literal("update"), expectedVersion: z.number().int().min(1), name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).nullable().optional(), config: profileConfigSchema.optional() }).strict(),
  z.object({ op: z.literal("delete") }).strict(),
]);
export type ProfileChange = z.infer<typeof profileChangeSchema>;

// ── settings change requests ────────────────────────────────────

export const putSettingsBody = z.object({
  settings: settingsSchema,
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
export type PutSettingsBody = z.infer<typeof putSettingsBody>;

export const approveChangeBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export const rejectChangeBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

// ── batches / files ─────────────────────────────────────────────

const safeName = z.string().min(1).max(500)
  // eslint-disable-next-line no-control-regex
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim())
  .pipe(z.string().min(1, "file name is empty"));

export const createBatchBody = z.object({
  name: z.string().trim().min(1).max(200),
  targetFolderId: z.string().uuid().optional(),
  defaultTags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  defaultDocType: docTypeId.optional(),
  linkTarget: z.object({ target: linkTargetSchema, targetId: z.string().min(1).max(128).optional() }).strict().optional(),
  profileId: z.string().uuid().optional(),
}).strict();
export type CreateBatchBody = z.infer<typeof createBatchBody>;

export const uploadUrlsBody = z.object({
  files: z.array(z.object({
    name: safeName,
    mimeType: z.enum(ALLOWED_UPLOAD_MIME),
    sizeBytes: z.number().int().min(1),
  }).strict()).min(1).max(200),
}).strict();
export type UploadUrlsBody = z.infer<typeof uploadUrlsBody>;

export const completeFilesBody = z.object({
  files: z.array(z.object({ fileId: z.string().uuid() }).strict()).min(1).max(200),
}).strict();
export type CompleteFilesBody = z.infer<typeof completeFilesBody>;

export const fileActionBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const listBatchesQuery = z.object({
  status: z.enum(["open", "processing", "completed", "cancelled"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listBatchFilesQuery = z.object({
  state: z.string().max(24).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParam = z.object({ id: z.string().uuid() });
export const batchFileParams = z.object({ batchId: z.string().uuid(), fileId: z.string().uuid() });
