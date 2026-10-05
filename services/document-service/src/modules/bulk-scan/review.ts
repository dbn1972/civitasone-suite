/**
 * Post-OCR routing decision: ready_to_file, or needs_review with explicit reason codes.
 * Pure and deterministic (no LLM): confidence, classification certainty, PII policy, required fields.
 */
import type { BulkScanSettings } from "./validators.js";
import type { Classification, ExtractedField, PiiFinding } from "./ocr-contract.js";

export type ReviewReason = "LOW_CONFIDENCE" | "CLASSIFICATION_UNCERTAIN" | "PII_DETECTED" | `MISSING_FIELD:${string}` | `DEGRADED:${string}`;

export interface ReviewInput {
  meanConfidence: number;
  classification: Pick<Classification, "docType" | "confidence" | "uncertain"> & { presetDocType?: string | null };
  fields: Pick<ExtractedField, "kind">[];
  piiFindings: Pick<PiiFinding, "type">[];
  degraded?: readonly string[];
}

export function decideAfterOcr(
  input: ReviewInput,
  settings: Pick<BulkScanSettings, "reviewThreshold" | "classification" | "pii">,
): { target: "needs_review" | "ready_to_file"; reasons: ReviewReason[] } {
  const reasons: ReviewReason[] = [];
  if (input.meanConfidence < settings.reviewThreshold) reasons.push("LOW_CONFIDENCE");
  // With an operator preset the classifier only cross-checks: review on confident disagreement (`uncertain`) alone.
  const preset = Boolean(input.classification.presetDocType);
  if (input.classification.uncertain || (!preset && input.classification.confidence < settings.classification.uncertainBelow)) {
    reasons.push("CLASSIFICATION_UNCERTAIN");
  }
  if (settings.pii.reviewOnDetect && input.piiFindings.length > 0) reasons.push("PII_DETECTED");
  const cfg = settings.classification.docTypes.find((d) => d.id === input.classification.docType);
  const have = new Set(input.fields.map((f) => f.kind));
  for (const req of cfg?.requiredFields ?? []) if (!have.has(req)) reasons.push(`MISSING_FIELD:${req}`);
  for (const d of input.degraded ?? []) reasons.push(`DEGRADED:${d}`);
  return { target: reasons.length > 0 ? "needs_review" : "ready_to_file", reasons };
}
