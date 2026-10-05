import type {
  BBox, Classification, DocumentOcrResult, ExtractedField, PageResult, PiiAction, PiiFinding, PiiType,
} from "../types.js";
import { distinctPiiTypes } from "../post/pii.js";
import { maskDocumentPages } from "./mask.js";

/** Plain text of the whole document (pages joined with form-feed), PII mask/redact findings applied. */
export function toPlainText(result: DocumentOcrResult, pii: readonly PiiFinding[] = []): string {
  return maskDocumentPages(result.pages, pii).map((p) => p.text).join("\f");
}

export interface StructuredExtras {
  fields?: readonly ExtractedField[];
  classification?: Classification;
  pii?: readonly PiiFinding[];
  /** Include per-word entries (default true). */
  includeWords?: boolean;
  /** Caller-provided scalar metadata (document id, tenant-safe labels ...). Not scrubbed - keep it PII-free. */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface StructuredWord { text: string; confidence: number; bbox: BBox }
export interface StructuredLine { text: string; confidence: number; bbox: BBox; words?: StructuredWord[] }
export interface StructuredBlock { text: string; confidence: number; bbox: BBox; lines: StructuredLine[] }
export interface StructuredPage {
  pageNumber: number;
  text: string;
  meanConfidence: number;
  orientationDeg: 0 | 90 | 180 | 270 | null;
  script: string | null;
  providerId: PageResult["providerId"];
  source: "ocr" | "pdf_text_layer";
  blocks: StructuredBlock[];
}
export interface StructuredDocument {
  schemaVersion: 1;
  pageCount: number;
  meanConfidence: number;
  providerIds: DocumentOcrResult["providerIds"];
  classification: Classification | null;
  fields: ExtractedField[];
  /** Types only - never values. */
  pii: { detected: boolean; types: PiiType[]; countsByType: Partial<Record<PiiType, number>>; actions: Partial<Record<PiiType, PiiAction>> };
  metadata: Record<string, string | number | boolean | null>;
  pages: StructuredPage[];
}

export function toStructuredJson(result: DocumentOcrResult, extras: StructuredExtras = {}): StructuredDocument {
  const pii = extras.pii ?? [];
  const includeWords = extras.includeWords ?? true;
  const pages = maskDocumentPages(result.pages, pii);
  const countsByType: Partial<Record<PiiType, number>> = {};
  const actions: Partial<Record<PiiType, PiiAction>> = {};
  for (const f of pii) {
    countsByType[f.type] = (countsByType[f.type] ?? 0) + 1;
    actions[f.type] = f.action;
  }
  return {
    schemaVersion: 1,
    pageCount: result.pageCount,
    meanConfidence: result.meanConfidence,
    providerIds: [...result.providerIds],
    classification: extras.classification ?? null,
    fields: [...(extras.fields ?? [])],
    pii: { detected: pii.length > 0, types: distinctPiiTypes(pii), countsByType, actions },
    metadata: { ...(extras.metadata ?? {}) },
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber, text: p.text, meanConfidence: p.meanConfidence, orientationDeg: p.orientationDeg,
      script: p.script, providerId: p.providerId, source: p.source,
      blocks: p.blocks.map((b) => ({
        text: b.text, confidence: b.confidence, bbox: b.bbox,
        lines: b.lines.map((l) => ({
          text: l.text, confidence: l.confidence, bbox: l.bbox,
          ...(includeWords ? { words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) } : {}),
        })),
      })),
    })),
  };
}
