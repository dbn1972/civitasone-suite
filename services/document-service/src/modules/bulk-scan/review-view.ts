/**
 * Review presentation helpers (pure): masked field values, page assembly from the stored structured JSON.
 * Everything leaving this module is ALREADY masked: the structured JSON was masked per the tenant PII policy by
 * the OCR step, and field values of PII kinds are re-masked here defensively.
 */
import type { ExtractedField, PiiFinding } from "./ocr-contract.js";

const PII_FIELD_KINDS = new Set(["aadhaar", "pan", "account_no", "phone", "email"]);
export const isPiiFieldKind = (k: string): boolean => PII_FIELD_KINDS.has(k);

/** Last-4 style mask. Already-masked values (X / * / •) are returned unchanged. */
export function maskValue(kind: string, value: string): string {
  if (!isPiiFieldKind(kind)) return value;
  if (/[X*•]{3,}/.test(value)) return value;
  if (kind === "email") {
    const at = value.indexOf("@");
    return at > 0 ? value[0] + "***" + value.slice(at) : "***";
  }
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 4) return "X".repeat(digits.length);
  return "X".repeat(digits.length - 4) + digits.slice(-4);
}

export interface MaskedField { kind: string; value: string; raw: string; confidence: number; pageNumber: number; bbox: ExtractedField["bbox"] }

export function maskFields(fields: readonly Partial<ExtractedField>[] | null | undefined): MaskedField[] {
  return (fields ?? []).map((f) => {
    const kind = String(f.kind ?? "");
    return {
      kind, value: maskValue(kind, String(f.value ?? "")), raw: maskValue(kind, String(f.raw ?? f.value ?? "")),
      confidence: typeof f.confidence === "number" ? f.confidence : 0, pageNumber: typeof f.pageNumber === "number" ? f.pageNumber : 1,
      bbox: f.bbox ?? null,
    };
  });
}

interface BBox { x0: number; y0: number; x1: number; y1: number }
interface SJWord { text: string; confidence: number; bbox: BBox }
interface SJLine { words?: SJWord[]; bbox?: BBox }
interface SJBlock { lines?: SJLine[]; bbox?: BBox }
interface SJPage {
  pageNumber: number; text: string; meanConfidence: number; orientationDeg: number | null; script: string | null; blocks?: SJBlock[];
}

export interface ReviewPage {
  pageNumber: number; width: number; height: number; imageUrl: string | null; text: string; meanConfidence: number;
  orientationDeg: number | null; script: string | null; words: SJWord[];
}

/** Page extents are not stored; use the furthest word / block edge (the page image is in the same pixel space). */
function extents(page: SJPage): { width: number; height: number } {
  let w = 0, h = 0;
  for (const b of page.blocks ?? []) {
    if (b.bbox) { w = Math.max(w, b.bbox.x1); h = Math.max(h, b.bbox.y1); }
    for (const l of b.lines ?? []) {
      if (l.bbox) { w = Math.max(w, l.bbox.x1); h = Math.max(h, l.bbox.y1); }
      for (const x of l.words ?? []) { w = Math.max(w, x.bbox.x1); h = Math.max(h, x.bbox.y1); }
    }
  }
  return { width: Math.ceil(w), height: Math.ceil(h) };
}

export const MAX_WORDS_PER_PAGE = 4000;

/** Pages from the masked structured JSON, with reviewer text overrides applied (overrides are already masked). */
export function assemblePages(
  structured: unknown, overrides: Record<string, string> | null | undefined, imageUrls: ReadonlyMap<number, string>,
): ReviewPage[] {
  const pages = (structured as { pages?: SJPage[] } | null)?.pages ?? [];
  return pages.map((p) => {
    const words: SJWord[] = [];
    for (const b of p.blocks ?? []) for (const l of b.lines ?? []) for (const w of l.words ?? []) {
      if (words.length < MAX_WORDS_PER_PAGE) words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox });
    }
    const { width, height } = extents(p);
    return {
      pageNumber: p.pageNumber, width, height, imageUrl: imageUrls.get(p.pageNumber) ?? null,
      text: overrides?.[String(p.pageNumber)] ?? p.text, meanConfidence: p.meanConfidence,
      orientationDeg: p.orientationDeg ?? null, script: p.script ?? null, words,
    };
  });
}

export function maskPiiFindings(f: readonly Partial<PiiFinding>[] | null | undefined): Record<string, unknown>[] {
  // Findings never carry raw values (port contract); only whitelist the known fields.
  return (f ?? []).map((x) => ({
    type: x.type, pageNumber: x.pageNumber, start: x.start, end: x.end, bbox: x.bbox ?? null, action: x.action, maskedPreview: x.maskedPreview,
  }));
}

/** Pages joined with a form feed (same convention as the OCR plain text) with overrides applied. */
export function composeFinalText(structured: unknown, overrides: Record<string, string>): string {
  const pages = (structured as { pages?: SJPage[] } | null)?.pages ?? [];
  return pages.map((p) => overrides[String(p.pageNumber)] ?? p.text).join("\f");
}

/** Bounded single-line snippet for the search fallback column (masked text only). */
export function snippetOf(text: string, max = 4000): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
