import type { BBox, OcrWord, PageResult } from "../types.js";

export interface PageTextInput {
  pageNumber: number;
  text: string;
  words?: readonly OcrWord[];
  /** Used as the OCR-confidence fallback when no word box matches. */
  meanConfidence?: number;
}

export function isPageResult(p: PageResult | PageTextInput): p is PageResult {
  return "blocks" in p;
}

export function wordsOfPage(p: PageResult): OcrWord[] {
  const out: OcrWord[] = [];
  for (const b of p.blocks) for (const l of b.lines) out.push(...l.words);
  return out;
}

export function toPageInput(p: PageResult | PageTextInput): PageTextInput {
  if (isPageResult(p)) {
    return { pageNumber: p.pageNumber, text: p.text, words: wordsOfPage(p), meanConfidence: p.meanConfidence };
  }
  return p;
}

export function unionBBox(boxes: readonly BBox[]): BBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Case/punctuation/whitespace-insensitive key used to line raw matches up with OCR words. */
export function wordKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export interface WordHit { bbox: BBox; confidence: number }

/**
 * Find the `occurrence`-th (0-based) run of consecutive words whose concatenated key equals the key of `raw`.
 * Falls back to a single word containing the whole key. Returns null when nothing lines up.
 */
export function locateWords(words: readonly OcrWord[], raw: string, occurrence = 0): WordHit | null {
  const target = wordKey(raw);
  if (target === "" || words.length === 0) return null;
  const keys = words.map((w) => wordKey(w.text));
  let seen = 0;
  for (let i = 0; i < words.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(words.length, i + 8); j++) {
      acc += keys[j] ?? "";
      if (acc.length >= target.length) {
        if (acc === target) {
          if (seen === occurrence) {
            const run = words.slice(i, j + 1);
            return {
              bbox: unionBBox(run.map((w) => w.bbox)),
              confidence: run.reduce((s, w) => s + w.confidence, 0) / run.length,
            };
          }
          seen++;
        }
        break;
      }
    }
  }
  seen = 0;
  for (let i = 0; i < words.length; i++) {
    const k = keys[i] ?? "";
    const w = words[i];
    if (w && k.length >= target.length && k.includes(target)) {
      if (seen === occurrence) return { bbox: w.bbox, confidence: w.confidence };
      seen++;
    }
  }
  return null;
}
