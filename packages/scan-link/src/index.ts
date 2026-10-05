/**
 * @civitasone/scan-link
 *
 * Wire contract between document-service (bulk-scan filing) and the three
 * link-target services: hrms-service (employee personnel file), finance-service
 * (payment / voucher / bill) and estab-service (eOffice file).
 *
 * Flow (all cross-service writes go through the queue, never cross-schema SQL):
 *   1. document-service publishes LINK_TOPICS.request (a "<target>.scan-link.request" command).
 *   2. the target service consumer opens a tx, RE-CHECKS the target exists in the tenant,
 *      inserts its own scan-link row, enqueues an audit.event.record outbox event
 *      and a LINK_TOPICS.result event (linked | rejected | flagged).
 *   3. document-service consumes the result and updates its own link row.
 *   Unlink is the same shape with LINK_TOPICS.unlinkRequest (reason required) / unlinkResult.
 *
 * Read side: each target exposes a tenant-scoped internal lookup route
 * (GET /internal/v1/scan-link/lookup) used by document-service to auto-match
 * and to re-validate before approval.
 */
import { z } from "zod";

export const LINK_TARGETS = ["hr_employee", "finance_payment", "finance_voucher", "finance_bill", "eoffice_file"] as const;
export type LinkTarget = (typeof LINK_TARGETS)[number];
export const linkTargetSchema = z.enum(LINK_TARGETS);

/**
 * Target record id as carried on the wire. Deliberately NOT a uuid/charset regex: the reviewer may type any id
 * (document-service accepts up to 128 chars) and every target service must ANSWER a malformed or unknown id with a
 * `rejected / TARGET_NOT_FOUND` result (tested in estab with "EST/2026/1" and in hrms with "EMP-0042"). A stricter
 * schema would make the consumer drop the command silently and leave the link pending forever. Real ids are uuids
 * and each service re-validates against its own table inside its transaction. Length-bounded only.
 */
export const targetIdSchema = z.string().min(1).max(128);

/** Digit string of paise (bigint-safe, 1-18 digits). */
export const amountMinorSchema = z.string().regex(/^\d{1,18}$/);

// WIRE SCHEMAS ARE .strict(): an unknown key is rejected, not silently stripped (a typo or a producer/consumer
// version skew must fail loudly in tests). Consequence: an ADDITIVE contract change must be rolled out to the
// consumers (hrms/finance/estab/document-service) BEFORE any producer starts sending the new key.

/** Which service owns each target kind. */
export const TARGET_SERVICE: Record<LinkTarget, "hrms" | "finance" | "estab"> = {
  hr_employee: "hrms",
  finance_payment: "finance",
  finance_voucher: "finance",
  finance_bill: "finance",
  eoffice_file: "estab",
};

export type LinkService = (typeof TARGET_SERVICE)[LinkTarget];

export const LINK_TOPICS = {
  request: (svc: LinkService): string => svc + ".scan-link.request",
  result: (svc: LinkService): string => svc + ".scan-link.result",
  unlinkRequest: (svc: LinkService): string => svc + ".scan-link.unlink.request",
  unlinkResult: (svc: LinkService): string => svc + ".scan-link.unlink.result",
} as const;

/** Document types a scan can be filed as (starter set; per-tenant configurable in document-service). */
export const SCAN_DOC_TYPES = [
  "service_book", "pay_slip", "bill_voucher", "sanction_order", "office_order",
  "letter", "id_proof", "certificate", "other",
] as const;
export type ScanDocType = (typeof SCAN_DOC_TYPES)[number];

/** Masked, PII-safe metadata the target stores to render its "Scanned documents" section. */
export const linkedDocumentMetaSchema = z.object({
  documentId: z.string().uuid(),         // document.files.id in document-service
  batchId: z.string().uuid(),
  fileName: z.string().max(500),
  mimeType: z.string().max(128).nullable(),
  docType: z.string().max(64),
  pageCount: z.number().int().nonnegative(),
  ocrConfidence: z.number().min(0).max(1).nullable(),
  piiFlags: z.array(z.string().max(32)).max(20).default([]),   // types only, never values
  textPreviewMasked: z.string().max(500).nullable(),            // PII-masked excerpt
  filedAt: z.string().datetime(),
}).strict();
export type LinkedDocumentMeta = z.infer<typeof linkedDocumentMetaSchema>;

/** Finance-only: scan-derived fields used for reference+amount matching. */
export const financeMatchHintSchema = z.object({
  reference: z.string().max(100).nullable(),
  amountMinor: amountMinorSchema.nullable(), // bigint paise as string
}).strict();
export type FinanceMatchHint = z.infer<typeof financeMatchHintSchema>;

export const linkRequestSchema = z.object({
  linkId: z.string().uuid(),
  target: linkTargetSchema,
  targetId: targetIdSchema,
  document: linkedDocumentMetaSchema,
  requestedBy: z.string().uuid(),
  approvedBy: z.string().uuid().nullable(),
  financeHint: financeMatchHintSchema.optional(),
}).strict();
export type LinkRequest = z.infer<typeof linkRequestSchema>;


/**
 * ONE reason-code vocabulary shared by every link target (hrms, finance, estab) and document-service.
 * Result `reason` is ALWAYS one of these codes (never free text). Optional structured context goes in
 * `detail`: PII-free scalar values only (e.g. {expectedMinor, scannedMinor} as digit strings). The web
 * maps each code to en/hi copy.
 */
export const LINK_REASON_CODES = [
  "TARGET_NOT_FOUND",        // missing, other tenant, malformed id, or (hr) employee not found
  "TARGET_KIND_MISMATCH",    // target id exists but is not the requested kind
  "TARGET_CLASSIFIED",       // eOffice secret/top_secret file: linking refused
  "FILE_CLOSED",             // eOffice file closed/archived
  "UNSUPPORTED_TARGET",      // target kind not handled by this service
  "DOCUMENT_ALREADY_LINKED", // document already actively linked to this target
  "LINK_ALREADY_USED",       // linkId already consumed by a different request
  "AMOUNT_MISMATCH",         // finance: reference matches, amount differs (flagged, never attached)
  "REFERENCE_MISMATCH",      // finance: reference does not match the target
  "MISSING_MATCH_HINT",      // finance: no reference/amount hint supplied
  "LINK_NOT_FOUND",          // unlink: no such link for this target
  "LINK_ALREADY_UNLINKED",   // unlink: already unlinked
  "REASON_REQUIRED",         // unlink reason missing/too short
  "MAKER_CHECKER_VIOLATION", // link: approvedBy equals requestedBy (target-side maker != checker re-check)
] as const;
export type LinkReasonCode = (typeof LINK_REASON_CODES)[number];
export const linkReasonCodeSchema = z.enum(LINK_REASON_CODES);

/** PII-free structured context for a result (scalars only, max 8 keys, short strings). */
export const resultDetailSchema = z.record(z.string().max(40), z.union([z.string().max(64), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 8, "too many detail keys");
export type ResultDetail = z.infer<typeof resultDetailSchema>;

export const LINK_RESULT_STATUSES = ["linked", "rejected", "flagged_mismatch"] as const;
export const linkResultSchema = z.object({
  linkId: z.string().uuid(),
  target: linkTargetSchema,
  targetId: targetIdSchema,
  documentId: z.string().uuid(),
  status: z.enum(LINK_RESULT_STATUSES),
  reason: linkReasonCodeSchema.nullable(),
  detail: resultDetailSchema.optional(),
}).strict();
export type LinkResult = z.infer<typeof linkResultSchema>;

export const unlinkRequestSchema = z.object({
  linkId: z.string().uuid(),
  target: linkTargetSchema,
  targetId: targetIdSchema,
  documentId: z.string().uuid(),
  // NOT trimmed here on purpose: a whitespace-padded reason ("  ab  ") passes this schema and each target service
  // answers it with `rejected / REASON_REQUIRED` after trimming (hrms: scan-link-hr-real-db test). Trimming in the
  // schema would make the consumer drop the command and strand the link in unlink_requested. Consumers must trim.
  reason: z.string().min(5).max(500),
  requestedBy: z.string().uuid(),
}).strict();
export type UnlinkRequest = z.infer<typeof unlinkRequestSchema>;

export const unlinkResultSchema = z.object({
  linkId: z.string().uuid(),
  documentId: z.string().uuid(),
  status: z.enum(["unlinked", "rejected"]),
  reason: linkReasonCodeSchema.nullable(),
  detail: resultDetailSchema.optional(),
}).strict();
export type UnlinkResult = z.infer<typeof unlinkResultSchema>;

/** Response shape of GET /internal/v1/scan-link/lookup on each target service. */
export const lookupCandidateSchema = z.object({
  target: linkTargetSchema,
  targetId: targetIdSchema,
  label: z.string().max(300),            // e.g. "EMP-0042 - R. Kumar", "PAY-2026-0091"
  amountMinor: amountMinorSchema.nullable(),    // finance only
  reference: z.string().nullable(),
  confidence: z.number().min(0).max(1),  // 1 = exact key match
  // Finance reference-only matches (additive, optional): the amount the caller asked for and whether it
  // equals the record amount, so the reviewer sees the mismatch. Absent on hr/eoffice candidates.
  requestedAmountMinor: amountMinorSchema.nullable().optional(),
  amountMatches: z.boolean().nullable().optional(),
}).strict();
export type LookupCandidate = z.infer<typeof lookupCandidateSchema>;
export const lookupResponseSchema = z.object({ data: z.array(lookupCandidateSchema).max(20) }).strict();

export * from "./fixtures.js";

// ---------------------------------------------------------------- free-text scrubbing for audit

// KEEP IDENTICAL to SCRUBBERS in packages/ocr/src/post/pii.ts (scrubString); the parity test in
// packages/ocr/tests/post/scrub-parity.test.ts runs one corpus through both. Digit groups are masked fully,
// keeping at MOST the last 4 digits.
const SCRUBBERS: readonly [RegExp, (m: string) => string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, () => "[EMAIL]"],
  [/(?<![A-Za-z0-9])[A-Z]{5}[0-9OIl]{4}[A-Z](?![A-Za-z0-9])/g, (m) => "XXXXXX" + m.slice(-4)],
  [/(?<!\d)\d{4}[\s-]{0,2}\d{4}[\s-]{0,2}\d{4}[\s-]{0,2}\d{4}(?!\d)/g, (m) => "XXXX XXXX XXXX " + m.replace(/\D/g, "").slice(-4)],
  [/(?<!\d)\d{4}[\s-]{0,2}\d{4}[\s-]{0,2}\d{4}(?!\d)/g, (m) => "XXXX XXXX " + m.replace(/\D/g, "").slice(-4)],
  [/(?<!\d)(?:\+?91[ -]?|0[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g, (m) => "XXXXXX" + m.replace(/\D/g, "").slice(-4)],
  [/(?<!\d)\d{9,}(?!\d)/g, (m) => "X".repeat(m.length - 4) + m.slice(-4)],
];

/**
 * Scrub PII-looking substrings (email, PAN, Aadhaar-style, Indian phone, 9+ digit account runs) from
 * user-typed free text (e.g. an unlink reason) and cap it at 500 chars. Use for anything stored in an
 * audit event. Patterns are kept identical to scrubString in @civitasone/ocr (not imported: that
 * package pulls in sharp/pdfjs, which the target services must not depend on); a parity test in
 * packages/ocr/tests/post/scrub-parity.test.ts guards against drift.
 */
export function scrubReasonText(s: string, maxLen = 500): string {
  let out = s;
  for (const [re, fn] of SCRUBBERS) out = out.replace(re, fn);
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}
