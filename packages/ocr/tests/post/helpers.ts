import type { OcrWord, PageResult } from "../../src/types.js";

/** Build a PageResult from lines of text with synthetic word boxes (10px per char, 30px line pitch). */
export function makePage(lines: string[], pageNumber = 1, conf = 0.95): PageResult {
  const words: OcrWord[][] = lines.map((line, li) => {
    const out: OcrWord[] = [];
    let x = 20;
    for (const tok of line.split(/\s+/).filter(Boolean)) {
      out.push({ text: tok, confidence: conf, bbox: { x0: x, y0: 20 + li * 30, x1: x + tok.length * 10, y1: 40 + li * 30 } });
      x += tok.length * 10 + 10;
    }
    return out;
  });
  return {
    pageNumber,
    text: lines.join("\n"),
    meanConfidence: conf,
    orientationDeg: 0,
    script: "Latin",
    providerId: "tesseract",
    timings: { totalMs: 1, recognizeMs: 1 },
    source: "ocr",
    blocks: [
      {
        text: lines.join("\n"), confidence: conf,
        bbox: { x0: 20, y0: 20, x1: 800, y1: 40 + lines.length * 30 },
        lines: lines.map((l, i) => ({
          text: l, confidence: conf,
          bbox: { x0: 20, y0: 20 + i * 30, x1: 800, y1: 40 + i * 30 },
          words: words[i] ?? [],
        })),
      },
    ],
  };
}
