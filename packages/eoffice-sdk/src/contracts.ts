/**
 * @civitasone/eoffice-sdk — wire contracts
 *
 * Single source of truth for the cross-module eOffice integration contract:
 *  - SOURCE_REF_TYPES: the kinds of business entities any module can raise an
 *    eFile for (mirrors estab-service linkage validators).
 *  - MODULE_CALLBACK_TOPICS: the SQS topics estab-service emits the approval
 *    decision back on, keyed by source ref type.
 *  - The request/response shapes for POST /v1/estab/files/from-module.
 *
 * Keep this in lockstep with:
 *   services/estab-service/src/modules/linkage/validators.ts
 *   services/estab-service/src/topics.ts (MODULE_CALLBACK_TOPICS)
 */
import { z } from "zod";

/** Business entities a module can submit to eOffice for formal approval. */
export const SOURCE_REF_TYPES = [
  "finance_sanction", "finance_payment", "finance_reappropriation",
  "procurement_award", "procurement_po",
  "hr_promotion", "hr_transfer", "hr_disciplinary", "hr_leave_special", "hr_recruitment",
  // SmartTransfer OS (ST-M01-16): a transfer ORDER and a posting CYCLE raised to
  // eOffice for formal approval. Spec §11; governing (PROPOSED) decision D-ST-08
  // option (a) — approvals flow via the eOffice linkage with these new callback
  // types. The decision consumer is smarttransfer-service (unmerged, PR #1979),
  // so these are NOT in the hard-coded DECISION_CONSUMED_REF_TYPES; see below.
  "hr_transfer_order", "hr_posting_cycle",
  "grant_scheme", "grant_disbursement",
  "asset_disposal", "legal_opinion", "contract_award",
] as const;

export type SourceRefType = (typeof SOURCE_REF_TYPES)[number];

export const CLASSIFICATIONS = ["top_secret", "secret", "confidential", "public"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const PRIORITIES = ["normal", "urgent", "immediate"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Decision callback topics — estab-service publishes the approval decision back
 * to the originating module on these topics. Keyed by source ref type so the
 * source module subscribes to exactly the topics it cares about.
 */
export const MODULE_CALLBACK_TOPICS: Record<SourceRefType, string> = {
  finance_sanction:        "finance.sanction.file_decided",
  finance_payment:         "finance.payment.file_decided",
  finance_reappropriation: "finance.reappropriation.file_decided",
  procurement_award:       "procurement.award.file_decided",
  procurement_po:          "procurement.po.file_decided",
  hr_promotion:            "hrms.promotion.file_decided",
  hr_transfer:             "hrms.transfer.file_decided",
  hr_disciplinary:         "hrms.disciplinary.file_decided",
  hr_leave_special:        "hrms.leave_special.file_decided",
  hr_recruitment:          "hrms.recruitment.file_decided",
  // SmartTransfer OS owner topics (ST-M01-16). Dash-form lengths (bus.ts
  // truncates at 45): hrms-transfer_order-file_decided = 32,
  // hrms-posting_cycle-file_decided = 31 — both well under the limit.
  hr_transfer_order:       "hrms.transfer_order.file_decided",
  hr_posting_cycle:        "hrms.posting_cycle.file_decided",
  grant_scheme:            "grant.scheme.file_decided",
  grant_disbursement:      "grant.disbursement.file_decided",
  asset_disposal:          "asset.disposal.file_decided",
  legal_opinion:           "legal.opinion.file_decided",
  contract_award:          "contract.award.file_decided",
};

/**
 * Source ref types whose decision callback is ACTUALLY consumed by a source
 * module today (a registered `*.file_decided` consumer applies the decision).
 * Raising an eFile for a type NOT in this set would emit an approval the source
 * never acts on — the decision would be silently lost — so the estab linkage
 * raise path rejects unsupported types (fail-closed). Add a type here only once
 * its decision consumer exists. (R21)
 *
 * NOT in this set (ST-M01-16): `hr_transfer_order` and `hr_posting_cycle`. Their
 * decision consumer is smarttransfer-service, which is not on main yet (PR
 * #1979). Hard-coding them here now would make estab accept a raise whose
 * callback no one consumes on main — exactly the orphan R21 exists to prevent.
 * Instead they are enabled per-deployment via EXTRA_DECISION_CONSUMED_REF_TYPES
 * (see `isDecisionConsumed`): a deployment sets it once it runs a service that
 * subscribes to the SmartTransfer callback topics. This keeps main fail-closed
 * and needs no D-101 allow-list addition against the still-PROPOSED D-ST-08.
 */
export const DECISION_CONSUMED_REF_TYPES: ReadonlySet<SourceRefType> = new Set<SourceRefType>([
  "finance_sanction", "finance_payment", "finance_reappropriation",
  "procurement_po", "procurement_award",
  "hr_promotion", "hr_transfer", "hr_disciplinary", "hr_leave_special", "hr_recruitment",
  "grant_disbursement", "grant_scheme",
  "asset_disposal", "legal_opinion", "contract_award",
]);

/**
 * The env var a deployment sets (comma-separated source ref types) to extend
 * the decision-consumed allow-list for types whose consumer it actually runs
 * but which are not yet in the hard-coded set on main. Only values that are
 * also valid `SOURCE_REF_TYPES` take effect — an unknown string is ignored, so
 * the raise path stays fail-closed for genuinely unsupported types. Plain
 * config (a list of ref-type names); carries no secret.
 */
export const EXTRA_DECISION_CONSUMED_ENV = "EXTRA_DECISION_CONSUMED_REF_TYPES";

function extraConsumedFromEnv(): ReadonlySet<string> {
  const raw = process.env[EXTRA_DECISION_CONSUMED_ENV];
  if (!raw) return new Set();
  const valid = new Set<string>(SOURCE_REF_TYPES);
  return new Set(
    raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0 && valid.has(s)),
  );
}

/**
 * True when a raised eFile of this type will have its decision consumed —
 * either because it is in the hard-coded `DECISION_CONSUMED_REF_TYPES`, or
 * because the deployment opted it in via `EXTRA_DECISION_CONSUMED_REF_TYPES`
 * (a service that subscribes to that type's callback topic is running).
 */
export function isDecisionConsumed(refType: string): boolean {
  if (DECISION_CONSUMED_REF_TYPES.has(refType as SourceRefType)) return true;
  return extraConsumedFromEnv().has(refType);
}

/** The SQS command topic estab-service consumes to create a file from a module. */
export const ESTAB_FILE_FROM_MODULE_TOPIC = "estab.file.from_module";

// ─── Raise-file request ──────────────────────────────────────────────────────

export const raiseFileInput = z.object({
  refType:        z.enum(SOURCE_REF_TYPES),
  refId:          z.string().uuid(),
  subject:        z.string().min(3).max(500),
  dept:           z.string().min(1),
  classification: z.enum(CLASSIFICATIONS).default("confidential"),
  priority:       z.enum(PRIORITIES).default("normal"),
  initiatedBy:    z.string().uuid(),
  currentWith:    z.string().uuid(),
  approvalChain:  z.string().min(1),
  initialNote:    z.string().min(1),
  /** Decision-relevant context — amount (paise), HoA, vendor, etc. */
  context:        z.record(z.unknown()).optional(),
});
export type RaiseFileInput = z.input<typeof raiseFileInput>;
export type RaiseFileRequest = z.infer<typeof raiseFileInput>;

export const acceptedResult = z.object({
  id: z.string().uuid(),
  fileNo: z.string(),
  status: z.string(),
  correlationId: z.string(),
});
export type AcceptedResult = z.infer<typeof acceptedResult>;

// ─── File-by-ref query result ─────────────────────────────────────────────────

export const fileByRefResult = z.object({
  id: z.string().uuid(),
  file_no: z.string(),
  subject: z.string(),
  status: z.string(),
  classification: z.string(),
  current_with: z.string().nullable(),
  source_ref_type: z.string(),
  source_ref_id: z.string(),
  initiated_by: z.string().nullable(),
  approval_chain: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FileByRef = z.infer<typeof fileByRefResult>;

// ─── Decision callback payload ─────────────────────────────────────────────────

export const DECISIONS = ["approved", "rejected", "returned"] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * Payload shape estab-service emits on MODULE_CALLBACK_TOPICS. Consume this in
 * the source module's worker to react to the eOffice decision.
 */
export const decisionCallbackPayload = z.object({
  fileId: z.string().uuid(),
  fileNo: z.string(),
  refType: z.enum(SOURCE_REF_TYPES),
  refId: z.string().uuid(),
  decision: z.enum(DECISIONS),
  notingId: z.string().uuid().nullable().optional(),
  dscHash: z.string().nullable().optional(),
  // Optional machine-readable reason for the outcome (e.g. why a file was
  // rejected or returned). Additive and backward-compatible: a producer that
  // omits it stays valid (tolerant reader, D-18). ST-M01-16.
  reasonCode: z.string().nullable().optional(),
  decidedBy: z.string(),
  decidedAt: z.string(),
});
export type DecisionCallback = z.infer<typeof decisionCallbackPayload>;

// ─── Approval resolution (amount-band matrix preview) ─────────────────────────

export const resolvedApproval = z.object({
  ruleId: z.string(),
  label: z.string(),
  workflowDefinitionCode: z.string(),
  startNodeKey: z.string(),
  steps: z.array(z.object({ role: z.string(), label: z.string() })),
});
export type ResolvedApproval = z.infer<typeof resolvedApproval>;

// ─── Bulk-scan link target (GAP-ADMIN-BULK-SCAN-02) ───────────────────────────
// Mirrors @civitasone/scan-link lookupCandidateSchema for the eoffice_file target
// (kept local so the SDK stays dependency-light; scan-link tests pin the shape).

export const scanLookupQuery = z
  .object({
    fileNo: z.string().trim().min(1).max(100).optional(),
    subject: z.string().trim().min(1).max(300).optional(),
  })
  .refine((q) => q.fileNo !== undefined || q.subject !== undefined, { message: "fileNo or subject is required" });
export type ScanLookupQuery = z.input<typeof scanLookupQuery>;

export const scanLookupCandidate = z.object({
  target: z.literal("eoffice_file"),
  targetId: z.string().uuid(),
  label: z.string().max(300),
  amountMinor: z.string().nullable(),
  reference: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ScanLookupCandidate = z.infer<typeof scanLookupCandidate>;
export const scanLookupResponse = z.object({ data: z.array(scanLookupCandidate).max(20) });

export const clearanceCheckQuery = z.object({
  fileId: z.string().uuid(),
  userId: z.string().uuid(),
  roles: z.array(z.string().min(1)).max(30),
});
export type ClearanceCheckQuery = z.input<typeof clearanceCheckQuery>;
export const clearanceCheckResponse = z.object({
  data: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
});
export type ClearanceCheckResult = z.infer<typeof clearanceCheckResponse>["data"];

export const SCANNED_DOCUMENT_STATES = ["linked", "unlinked"] as const;
/** PII-masked metadata of a scanned document filed on an eFile (never the file bytes). */
export const scannedDocument = z.object({
  id: z.string().uuid(),
  linkId: z.string().uuid(),
  documentId: z.string().uuid(),
  batchId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string().nullable(),
  docType: z.string(),
  pageCount: z.number().int().nonnegative(),
  ocrConfidence: z.number().min(0).max(1).nullable(),
  piiFlags: z.array(z.string()),
  textPreviewMasked: z.string().nullable(),
  state: z.enum(SCANNED_DOCUMENT_STATES),
  unlinkReason: z.string().nullable(),
  linkedBy: z.string().uuid(),
  approvedBy: z.string().uuid().nullable(),
  filedAt: z.string(),
});
export type ScannedDocument = z.infer<typeof scannedDocument>;
export const scannedDocumentsResponse = z.object({ data: z.array(scannedDocument) });
