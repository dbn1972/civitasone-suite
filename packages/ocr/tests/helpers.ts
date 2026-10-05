import sharp from "sharp";
import type { OcrProvider, OcrProviderId, PageImage, PageResult, RecognizeOptions } from "../src/types.js";

export function fakePage(pageNumber: number, data = new Uint8Array([pageNumber, 1, 2, 3])): PageImage {
  return { pageNumber, data, mimeType: "image/png", width: 100, height: 100, dpi: 300 };
}

export function pageResult(page: PageImage, confidence: number, providerId: OcrProviderId = "tesseract", text = "hello world"): PageResult {
  return {
    pageNumber: page.pageNumber, text, blocks: [], meanConfidence: confidence, orientationDeg: null, script: "Latin",
    providerId, timings: { totalMs: 1, recognizeMs: 1 }, source: "ocr",
  };
}

export interface FakeProvider extends OcrProvider {
  calls: Array<{ pages: number[]; opts: RecognizeOptions }>;
}

/** `behave(callIndex, pages)` returns confidences per page or throws / never settles. */
export function fakeProvider(
  id: OcrProviderId,
  behave: (call: number, pages: PageImage[], opts: RecognizeOptions) => Promise<PageResult[]> | PageResult[],
  available = true,
): FakeProvider {
  const calls: FakeProvider["calls"] = [];
  return {
    id,
    calls,
    isAvailable: async () => available,
    recognize: async (pages, opts) => {
      calls.push({ pages: pages.map((p) => p.pageNumber), opts });
      return behave(calls.length - 1, pages, opts);
    },
    dispose: async () => undefined,
  };
}

/** A white page with N black "text lines" (rectangles), optionally with a margin and a dark scanner border. */
export async function syntheticTextPng(opts: { width?: number; height?: number; margin?: number; blackBorder?: number } = {}): Promise<Buffer> {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const margin = opts.margin ?? 0;
  const rects: string[] = [];
  for (let row = 0; row < 10; row++) {
    const y = margin + 30 + row * 40;
    if (y + 12 > height - margin) break;
    for (let col = 0; col < 12; col++) {
      const x = margin + 20 + col * 55;
      if (x + 45 > width - margin) break;
      rects.push(`<rect x="${x}" y="${y}" width="${30 + ((row * 7 + col * 13) % 15)}" height="12" fill="black"/>`);
    }
  }
  const border = opts.blackBorder
    ? `<rect x="0" y="0" width="${width}" height="${opts.blackBorder}" fill="black"/><rect x="0" y="${height - opts.blackBorder}" width="${width}" height="${opts.blackBorder}" fill="black"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${rects.join("")}${border}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
