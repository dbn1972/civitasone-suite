/**
 * REAL end-to-end OCR proof: render known text -> tesseract.js (via TesseractProvider) -> character error rate.
 * Prints one parseable line per language:  CER <lang> <value> n=<samples>   (or `CER <lang> skipped reason=...`).
 * Needs traineddata locally (see setup.ts); languages whose data/font cannot be obtained are SKIPPED, never faked.
 */
import { afterAll, describe, expect, it } from "vitest";
import { TesseractProvider } from "../../src/providers/tesseract.js";
import { toPageImage } from "../../src/preprocess/index.js";
import { FIXTURE_TEXT, characterErrorRate, makeLanguageFixture, renderTextPage, type FixtureLang } from "../../src/fixtures/index.js";
import type { OcrLang } from "../../src/types.js";
import { ensureTessdata, tessdataDir } from "./setup.js";

/** Thresholds are set slightly above the CER measured on the generated 300-DPI fixtures (see report). */
export const CER_THRESHOLD: Record<FixtureLang, number> = {
  eng: 0.02, hin: 0.03, mar: 0.02, ben: 0.02, tam: 0.04, tel: 0.02, guj: 0.02,
};
/** Degraded variants (skew 3 deg, blur 1.6, 150 dpi, JPEG q40) - threshold set after measuring, see report. */
export const CER_THRESHOLD_DEGRADED: Record<FixtureLang, number> = {
  eng: 0.01, hin: 0.03, mar: 0.02, ben: 0.03, tam: 0.04, tel: 0.02, guj: 0.02,
};
const SIZES = [11, 14, 18];

const provider = new TesseractProvider({ maxWorkers: 2, tessdataPath: tessdataDir(), idleTimeoutMs: 0 });
afterAll(async () => { await provider.dispose(); });

const results: Record<string, number> = {};

/** skew by +/-3 deg (alternating), blur sigma 1.6, downscale to 150 dpi, JPEG q40 round trip. */
async function degrade(png: Buffer, variant: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const skewed = await sharp(png).rotate(variant % 2 === 0 ? 3 : -3, { background: "#ffffff" }).blur(1.6).toBuffer();
  const meta = await sharp(skewed).metadata();
  const small = await sharp(skewed).resize(Math.round((meta.width ?? 2480) * (150 / 300))).jpeg({ quality: 40 }).toBuffer();
  return sharp(small).png().toBuffer();
}

describe.each(Object.keys(FIXTURE_TEXT) as FixtureLang[])("CER %s @300dpi", (lang) => {
  it(`recognises generated ${lang} text`, async (ctx) => {
    const dataMissing = await ensureTessdata(lang);
    if (dataMissing) { process.stdout.write(`CER ${lang} skipped reason=${dataMissing}\n`); ctx.skip(); return; }
    const probe = await makeLanguageFixture(lang);
    if ("unavailable" in probe) { process.stdout.write(`CER ${lang} skipped reason=${probe.unavailable}\n`); ctx.skip(); return; }
    const cers: number[] = [];
    for (const size of SIZES) {
      const page = await renderTextPage(FIXTURE_TEXT[lang], { fontPath: probe.fontPath, dpi: 300, fontSizePt: size });
      const img = await toPageImage(page.png, 1, 300);
      const [res] = await provider.recognize([img], { langs: [lang as OcrLang] });
      const cer = characterErrorRate(FIXTURE_TEXT[lang].join("\n"), res?.text ?? "");
      if (process.env["OCR_CER_DEBUG"]) process.stdout.write(`DEBUG ${lang} ${size}pt cer=${cer.toFixed(4)} text=${JSON.stringify(res?.text)}\n`);
      cers.push(cer);
    }
    const mean = cers.reduce((a, b) => a + b, 0) / cers.length;
    results[lang] = mean;
    process.stdout.write(`CER ${lang} ${mean.toFixed(4)} n=${cers.length}\n`);
    expect(mean).toBeLessThanOrEqual(CER_THRESHOLD[lang]);

    // degraded scan simulation
    const dcers: number[] = [];
    for (const size of SIZES) {
      const page = await renderTextPage(FIXTURE_TEXT[lang], { fontPath: probe.fontPath, dpi: 300, fontSizePt: size });
      const degraded = await degrade(page.png, size);
      expect(degraded.equals(page.png)).toBe(false);
      const img = await toPageImage(degraded, 1, 150);
      const [res] = await provider.recognize([img], { langs: [lang as OcrLang] });
      const cer = characterErrorRate(FIXTURE_TEXT[lang].join("\n"), res?.text ?? "");
      if (process.env["OCR_CER_DEBUG"]) process.stdout.write(`DEBUG ${lang}-degraded ${size}pt cer=${cer.toFixed(4)} text=${JSON.stringify(res?.text)}\n`);
      dcers.push(cer);
    }
    const dmean = dcers.reduce((a, b) => a + b, 0) / dcers.length;
    process.stdout.write(`CER ${lang}-degraded ${dmean.toFixed(4)} n=${dcers.length}\n`);
    expect(dmean).toBeLessThanOrEqual(CER_THRESHOLD_DEGRADED[lang]);
  }, 300_000);
});

describe("CER helper", () => {
  it("is 0 for identical, whitespace-normalised, and proportional for edits", () => {
    expect(characterErrorRate("a  b\nc", "a b c")).toBe(0);
    expect(characterErrorRate("abcd", "abxd")).toBeCloseTo(0.25);
    expect(characterErrorRate("", "")).toBe(0);
    expect(characterErrorRate("", "x")).toBe(1);
    expect(characterErrorRate("कार्य", "कार्य")).toBe(0);
  });
});
