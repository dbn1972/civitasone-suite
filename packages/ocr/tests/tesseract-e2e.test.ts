/**
 * Real tesseract.js (WASM) end-to-end for `eng` + OSD orientation. Needs traineddata offline:
 *   OCR_TESSDATA_PATH=<dir with eng.traineddata[.gz] and osd.traineddata[.gz]>
 * Skipped (not faked) when the data is absent. The multi-language CER suite lives with H-OCR-POST.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { OcrChain } from "../src/chain.js";
import { TesseractOsdDetector } from "../src/preprocess/index.js";
import { processDocument } from "../src/process.js";
import { TesseractProvider } from "../src/providers/tesseract.js";

const dir = process.env.OCR_TESSDATA_PATH;
const has = (lang: string): boolean => !!dir && (existsSync(join(dir, `${lang}.traineddata.gz`)) || existsSync(join(dir, `${lang}.traineddata`)));
const haveEng = has("eng");
const haveOsd = haveEng && has("osd");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="520"><rect width="100%" height="100%" fill="white"/>
<text x="50" y="130" font-size="68" font-family="DejaVu Sans, Arial, sans-serif" fill="black">The quick brown fox jumps over</text>
<text x="50" y="270" font-size="68" font-family="DejaVu Sans, Arial, sans-serif" fill="black">the lazy dog near the river bank</text>
<text x="50" y="410" font-size="68" font-family="DejaVu Sans, Arial, sans-serif" fill="black">Government of India order 2026</text></svg>`;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const EXPECTED = "the quick brown fox jumps over the lazy dog near the river bank government of india order 2026";

const provider = new TesseractProvider({ maxWorkers: 2, idleTimeoutMs: 0 });
const detector = new TesseractOsdDetector();
afterAll(async () => { await provider.dispose(); await detector.dispose(); });

describe("real tesseract.js", () => {
  // FLAKY-SKIP: environment-gated on eng traineddata (OCR_TESSDATA_PATH); deterministic when present, not flaky (expires: 2027-10-01)
  it.skipIf(!haveEng)("recognises rendered English text end to end through preprocessing", async () => {
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const chain = new OcrChain({ providers: [{ provider }], langs: ["eng"] });
    const out = await processDocument({ data: png }, { chain, orientationDetector: null });
    const page = out.result.pages[0];
    expect(norm(page?.text ?? "")).toBe(EXPECTED);
    expect(page?.script).toBe("Latin");
    expect(page?.meanConfidence).toBeGreaterThan(0.8);
    const words = page?.blocks.flatMap((b) => b.lines.flatMap((l) => l.words)) ?? [];
    expect(words.length).toBeGreaterThanOrEqual(17);
    for (const w of words) {
      expect(w.confidence).toBeGreaterThanOrEqual(0);
      expect(w.confidence).toBeLessThanOrEqual(1);
      expect(w.bbox.x1).toBeGreaterThan(w.bbox.x0);
    }
  }, 120_000);

  // FLAKY-SKIP: environment-gated on osd traineddata (OCR_TESSDATA_PATH); deterministic when present, not flaky (expires: 2027-10-01)
  it.skipIf(!haveOsd)("auto-orients a page rotated 90 and 180 degrees using OSD, then reads it", async () => {
    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const chain = new OcrChain({ providers: [{ provider }], langs: ["eng"] });
    for (const rot of [90, 180, 270] as const) {
      const turned = await sharp(base).rotate(rot, { background: "#fff" }).png().toBuffer();
      const out = await processDocument({ data: turned }, { chain, orientationDetector: detector, preprocess: { deskew: false } });
      expect(out.reports[0]?.rotationDeg).toBe(((360 - rot) % 360) as 0 | 90 | 180 | 270);
      expect(out.result.pages[0]?.orientationDeg).toBe(((360 - rot) % 360));
      expect(norm(out.result.pages[0]?.text ?? "")).toBe(EXPECTED);
    }
  }, 180_000);
});
