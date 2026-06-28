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
  grant_scheme:            "grant.scheme.file_decided",
  grant_disbursement:      "grant.disbursement.file_decided",
  asset_disposal:          "asset.disposal.file_decided",
  legal_opinion:           "legal.opinion.file_decided",
  contract_award:          "contract.award.file_decided",
};

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
  decidedBy: z.string(),
  decidedAt: z.string(),
});
export type DecisionCallback = z.infer<typeof decisionCallbackPayload>;
