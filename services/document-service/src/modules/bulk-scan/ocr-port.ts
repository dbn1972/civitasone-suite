/**
 * OcrPipelinePort - the ONLY surface the bulk-scan pipeline uses for OCR + post-processing.
 *
 * The production adapter (ocr-adapter.ts) satisfies it with @civitasone/ocr (processDocument, classify,
 * extractFields, detectPii, maskText, buildSearchablePdf, toStructuredJson). Tests use a fake port.
 * Everything crossing this boundary is ALREADY PII-masked per the tenant policy: the pipeline persists
 * `maskedText` / `structuredJson` / `fields` as given and never sees raw PII.
 */
import type { BulkScanSettings } from "./validators.js";
import type { ExtractedField, PiiFinding } from "./ocr-contract.js";
import type { ClassificationDetail } from "./classify-preset.js";

export interface OcrPipelineInput {
  tenantId: string;
  fileId: string;
  bytes: Uint8Array;
  mimeType: string;
  /** Effective settings (tenant settings with the batch profile applied). */
  settings: Pick<BulkScanSettings, "providerChain" | "languages" | "dpi" | "preprocessingSteps" | "bestOf" | "pii" | "classification" | "twoDigitYearPivot">;
  /** Operator-assigned doc type (batch default_doc_type or profile). The classifier only cross-checks it. */
  presetDocType?: string | null;
  signal?: AbortSignal;
}

export interface OcrPipelineOutput {
  pageCount: number;
  /** 0..1 mean word confidence across pages. */
  meanConfidence: number;
  providerIds: string[];
  /** Plain text with PII masked per policy. Safe to store/index. */
  maskedText: string;
  /** Structured document JSON (pages/blocks/lines/words), PII masked. */
  structuredJson: unknown;
  /** Searchable PDF with the PII-masked text layer, or null when it could not be produced. */
  searchablePdf: Uint8Array | null;
  classification: ClassificationDetail;
  /** Extracted fields; `raw` already masked for PII kinds. */
  fields: ExtractedField[];
  /** Findings carry offsets and masked previews only, never raw values. */
  piiFindings: PiiFinding[];
  /** Non-fatal degradations (e.g. "PDF_OMITTED_UNREDACTABLE_PII"); any entry routes the file to review. */
  degraded?: string[];
  /** Pages whose searchable-PDF text layer lost glyphs (e.g. no font for a script); shown to the reviewer. */
  degradedPages?: { pageNumber: number; reason: string; droppedScripts: string[] }[];
  /**
   * Review page images (PII-redacted where policy says redact). Omitted entirely when a redaction could not be
   * located, so an unredacted page image is never published. Stored as derivatives for the reviewer UI.
   */
  pageImages?: { pageNumber: number; data: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/tiff"; width: number; height: number }[];
}

export interface OcrPipelinePort {
  run(input: OcrPipelineInput): Promise<OcrPipelineOutput>;
}

/** Thrown by a port for a failure the pipeline should classify: retry (transient) or fail the file (permanent). */
export class OcrStepError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "OcrStepError";
  }
}
