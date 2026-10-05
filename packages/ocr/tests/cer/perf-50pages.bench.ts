/**
 * Perf benchmark (NOT part of default vitest). Run:
 *   pnpm --filter @civitasone/ocr exec tsx tests/cer/perf-50pages.bench.ts
 * OCRs a generated 50-page eng batch with bounded concurrency 2 (tesseract.js workers) and prints
 * pages/min and peak RSS (sampled every 500 ms). Needs eng.traineddata.gz (see setup.ts; set OCR_TEST_DOWNLOAD=1).
 */
import { TesseractProvider } from "../../src/providers/tesseract.js";
import { toPageImage } from "../../src/preprocess/index.js";
import { findFixtureFont, renderTextPage } from "../../src/fixtures/index.js";
import type { PageImage } from "../../src/types.js";
import { ensureTessdata, tessdataDir } from "./setup.js";

const PAGES = Number(process.env["BENCH_PAGES"] ?? 50);
const CONCURRENCY = 2;

async function main(): Promise<void> {
  const missing = await ensureTessdata("eng");
  if (missing) throw new Error(`eng traineddata unavailable: ${missing}`);
  const font = await findFixtureFont("eng");
  if (!font) throw new Error("no Latin font found");
  const base = [
    "Office Order No. {n}/2024 dated 15 March 2024",
    "Sanction is hereby accorded for the purchase of stationery",
    "The expenditure shall not exceed Rs. 45,000 only",
    "Employee ID EMP-{e} posted to the Accounts Branch",
    "This order issues with the approval of the competent authority",
    "Copy to: Accounts Officer, Personnel Section, Guard File",
  ];
  const pages: PageImage[] = [];
  for (let i = 1; i <= PAGES; i++) {
    const lines = base.map((l) => l.replace("{n}", String(i)).replace("{e}", String(20000 + i)));
    const png = await renderTextPage(lines, { fontPath: font, dpi: 300, fontSizePt: 14 });
    pages.push(await toPageImage(png.png, i, 300));
  }
  const provider = new TesseractProvider({ maxWorkers: CONCURRENCY, tessdataPath: tessdataDir(), idleTimeoutMs: 0 });
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 500);
  const t0 = performance.now();
  const res = await provider.recognize(pages, { langs: ["eng"] });
  const secs = (performance.now() - t0) / 1000;
  peak = Math.max(peak, process.memoryUsage().rss);
  clearInterval(timer);
  await provider.dispose();
  const words = res.reduce((s, p) => s + p.blocks.reduce((a, b) => a + b.lines.reduce((c, l) => c + l.words.length, 0), 0), 0);
  process.stdout.write(
    `PERF pages=${res.length} concurrency=${CONCURRENCY} seconds=${secs.toFixed(1)} pages_per_min=${((res.length / secs) * 60).toFixed(1)} peak_rss_mb=${(peak / 1048576).toFixed(0)} words=${words}\n`,
  );
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1); });
