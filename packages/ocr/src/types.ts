/**
 * @civitasone/ocr - shared contracts. Provider-agnostic.
 * Everything else in the package (providers, chain, preprocess, postprocess) is built on these.
 */

export const OCR_LANGS = ["eng", "hin", "ben", "tam", "tel", "mar", "guj", "kan", "mal", "pan", "ori", "urd", "asm"] as const;
export type OcrLang = (typeof OCR_LANGS)[number];

export const OCR_PROVIDER_IDS = ["tesseract", "google_docai", "aws_textract", "azure_docint", "bhashini"] as const;
export type OcrProviderId = (typeof OCR_PROVIDER_IDS)[number];
/** Provider id as recorded on a page: a real provider, or the embedded PDF text layer (no OCR run). */
export type PageProviderId = OcrProviderId | "pdf_text_layer";

/** Pixel box in the coordinate space of the (preprocessed) page image. */
export interface BBox { x0: number; y0: number; x1: number; y1: number }

export interface OcrWord { text: string; confidence: number /* 0..1 */; bbox: BBox }
export interface OcrLine { text: string; confidence: number; bbox: BBox; words: OcrWord[] }
export interface OcrBlock { text: string; confidence: number; bbox: BBox; lines: OcrLine[] }

/** One page image handed to a provider. */
export interface PageImage {
  /** 1-based page number inside the source document. */
  pageNumber: number;
  /** PNG/JPEG/TIFF bytes of the (preprocessed) page. */
  data: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/tiff";
  width: number;
  height: number;
  dpi: number;
}

export interface RecognizeOptions {
  langs: OcrLang[];
  /** Per-call timeout (ms) enforced by the chain. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PageResult {
  pageNumber: number;
  text: string;
  blocks: OcrBlock[];
  /** Mean word confidence 0..1 (0 when no words). */
  meanConfidence: number;
  /** Degrees clockwise the page had to be rotated to be upright, if detected. */
  orientationDeg: 0 | 90 | 180 | 270 | null;
  script: string | null;            // e.g. "Latin", "Devanagari"
  providerId: PageProviderId;
  timings: { totalMs: number; recognizeMs: number };
  /** Provider-specific flags, e.g. { sandbox: true } for cloud sandbox mocks. */
  metadata?: Record<string, string | number | boolean>;
  /** Set when the text came from a PDF text layer and OCR was skipped. */
  source: "ocr" | "pdf_text_layer";
}

/** The port every provider (local or cloud) implements. */
export interface OcrProvider {
  readonly id: OcrProviderId;
  /** false => provider is configured-but-unavailable (e.g. no credentials). */
  isAvailable(): Promise<boolean>;
  recognize(pages: PageImage[], opts: RecognizeOptions): Promise<PageResult[]>;
  /** Release workers / sockets. */
  dispose(): Promise<void>;
}

export class OcrNotImplementedError extends Error {
  constructor(public readonly providerId: OcrProviderId) {
    super(`OCR provider "${providerId}" production adapter is not implemented (sandbox mock only) - wire in UAT`);
    this.name = "OcrNotImplementedError";
  }
}

export class OcrProviderError extends Error {
  constructor(public readonly providerId: OcrProviderId, message: string, public readonly retryable = true) {
    super(message);
    this.name = "OcrProviderError";
  }
}

export interface DocumentOcrResult {
  pages: PageResult[];
  text: string;               // pages joined with form-feed
  meanConfidence: number;
  providerIds: PageProviderId[];
  pageCount: number;
  /** Per-provider outcome trail from the chain (absent for text-layer-only documents). */
  diagnostics?: ProviderAttemptDiagnostic[];
}

export interface ProviderAttemptDiagnostic {
  providerId: OcrProviderId;
  outcome: "ok" | "failed" | "skipped_unavailable" | "circuit_open" | "timeout" | "best_of_replaced" | "best_of_kept";
  attempts: number;
  error?: string;
  pages?: number[];
}

// ---- classification / extraction / PII (postprocess) --------------------------------

export type FieldKind =
  | "date" | "amount_inr" | "reference_no" | "file_no" | "pan" | "aadhaar" | "ifsc"
  | "phone" | "email" | "employee_no" | "voucher_no" | "account_no";

export interface ExtractedField {
  kind: FieldKind;
  /** Normalised value (date ISO yyyy-mm-dd, amount as paise string, ids upper-cased). */
  value: string;
  /** Raw text as seen on the page (masked if the field is PII and policy masks it). */
  raw: string;
  confidence: number;      // 0..1 combines OCR word confidence + validation (checksum/format)
  pageNumber: number;
  bbox: BBox | null;
}

export interface Classification {
  docType: string;                  // one of the tenant's configured type ids
  confidence: number;
  /** Which rules/keywords fired; used by reviewers. */
  evidence: string[];
  /** true when top-2 margin is too small, or confidence < threshold. */
  uncertain: boolean;
}

export type PiiType = "aadhaar" | "pan" | "bank_account" | "phone" | "email";
export type PiiAction = "mask" | "redact" | "flag";   // mask text+index, redact rendered copy, flag only
export type PiiPolicy = Record<PiiType, PiiAction>;

export const DEFAULT_PII_POLICY: PiiPolicy = {
  aadhaar: "mask", pan: "flag", bank_account: "flag", phone: "flag", email: "flag",
};

export interface PiiFinding {
  type: PiiType;
  pageNumber: number;
  /** Char offsets into that page's text. NEVER carries the raw value. */
  start: number;
  end: number;
  bbox: BBox | null;
  action: PiiAction;
  /** e.g. last-4 only: "XXXX XXXX 1234". */
  maskedPreview: string;
}
