/**
 * PR #2463 review, blocker 1: Devanagari marks must sit where the font puts them.
 *
 * Method (the reviewer's): rasterise each sample word from the issued PDF with pdf.js inside
 * Chromium and compare it with Chromium's own canvas text in the same embedded font, at 96 px.
 * For each word the ink bounding box, the x-centroid of the top 20% (above-base marks: e-matra,
 * anusvara, reph) and of the bottom 20% (below-base marks: u-matra, vocalic r, halant, nukta) are
 * compared. A 0.22 em offset is ~21 px at 96 px; the tolerance is 6 px (0.06 em: raster vs canvas
 * hinting differs by up to ~4 px on long words). A negative control draws
 * the same words with pdf-lib (no GPOS) and must be flagged, proving the check catches it.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderPdf, closePdfRenderer } from "../pdf.js";
import { OfficialPdf } from "./pdf-builder.js";
import { docFontBytes, docFontFaceCss } from "./fonts.js";
import { pdfFlatText, pdfFonts } from "../testing.js";

const req = createRequire(import.meta.url);
const PDFJS_BUILD = join(dirname(req.resolve("pdfjs-dist/package.json")), "build");
const WORDS = ["के", "कुल", "स्वीकृति", "कुल कटौतियाँ", "क्षेत्र", "कृषि", "केंद्रीय", "हिन्दी", "कार्यालय", "फ़ाइल"];
const TOL_PX = 6;
/** Ink width only guards against a wholesale layout change; subpixel advances drift on long words. */
const WIDTH_TOL_PX = 10;

afterAll(async () => { await closePdfRenderer(); });

/** One word per 700 x 120 pt page, 48 pt, through the shared Chromium document path. */
async function chromiumWordsPdf(): Promise<Uint8Array> {
  const pages = WORDS.map((w) => `<div class="pg"><div class="w">${w}</div></div>`).join("");
  const html = `<!DOCTYPE html><html lang="hi"><head><meta charset="utf-8"><style>${docFontFaceCss()}
    @page{size:700pt 120pt;margin:0} body{margin:0} .pg{width:700pt;height:120pt;position:relative;break-after:page}
    .w{position:absolute;left:20pt;top:24pt;font-family:"Noto Sans Devanagari";font-size:48pt;line-height:1;white-space:nowrap;color:#000}</style></head><body>${pages}</body></html>`;
  const r = await renderPdf({ html, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  expect(r.mode).toBe("playwright");
  return new Uint8Array(r.buffer);
}

/** The old engine: pdf-lib drawText with fontkit (GSUB only, GPOS dropped). Negative control. */
async function pdfLibWordsPdf(): Promise<Uint8Array> {
  if (!(globalThis as { regeneratorRuntime?: unknown }).regeneratorRuntime) req("regenerator-runtime/runtime.js");
  const fk = req("@pdf-lib/fontkit") as { default?: unknown };
  const { PDFDocument, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.registerFontkit((fk.default ?? fk) as Parameters<typeof doc.registerFontkit>[0]);
  const deva = await doc.embedFont(docFontBytes("devanagari", 400), { subset: true });
  for (const w of WORDS) doc.addPage([700, 120]).drawText(w, { x: 20, y: 40, size: 48, font: deva, color: rgb(0, 0, 0) });
  return doc.save();
}

interface Shape { word: string; dTop: number; dBot: number; dW: number }

/**
 * Runs inside Chromium (plain JS source, so the test transformer leaves its dynamic import alone):
 * rasterise each PDF page with pdf.js and the same word with canvas fillText, then compare the ink.
 */
const IN_BROWSER = String.raw`async ({ words, b64 }) => {
  const pdfjs = await import("http://pdfjs.local/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "http://pdfjs.local/pdf.worker.mjs";
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data }).promise;
  await document.fonts.load("96px \"Noto Sans Devanagari\"", "के");
  await document.fonts.ready;
  const ink = (ctx, W, H) => {
    const d = ctx.getImageData(0, 0, W, H).data; let x0 = W, y0 = H, x1 = -1, y1 = -1; const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] < 128) { m[y * W + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const H2 = y1 - y0 + 1;
    const cen = (ya, yb) => { let sx = 0, n = 0; for (let y = ya; y < yb; y++) for (let x = x0; x <= x1; x++) if (m[y * W + x]) { sx += x - x0; n++; } return n ? sx / n : 0; };
    return { w: x1 - x0 + 1, top: cen(y0, y0 + Math.round(H2 * 0.2)), bot: cen(y1 - Math.round(H2 * 0.2), y1 + 1) };
  };
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const pg = await doc.getPage(i + 1); const vp = pg.getViewport({ scale: 2 });
    const c1 = document.createElement("canvas"); c1.width = vp.width; c1.height = vp.height;
    const x1 = c1.getContext("2d"); x1.fillStyle = "#fff"; x1.fillRect(0, 0, c1.width, c1.height);
    await pg.render({ canvasContext: x1, viewport: vp }).promise;
    const c2 = document.createElement("canvas"); c2.width = vp.width; c2.height = vp.height;
    const x2 = c2.getContext("2d"); x2.fillStyle = "#fff"; x2.fillRect(0, 0, c2.width, c2.height);
    x2.fillStyle = "#000"; x2.font = "96px \"Noto Sans Devanagari\""; x2.fillText(words[i], 40, vp.height - 80);
    const A = ink(x1, c1.width, c1.height), B = ink(x2, c2.width, c2.height);
    out.push({ word: words[i], dTop: Math.abs(A.top - B.top), dBot: Math.abs(A.bot - B.bot), dW: Math.abs(A.w - B.w) });
  }
  return out;
}`;

async function compareWithChromiumText(pdf: Uint8Array): Promise<Shape[]> {
  const { chromium } = (await import("playwright-core")) as unknown as { chromium: { launch(o: object): Promise<{ newPage(o: object): Promise<any>; close(): Promise<void> }> } };
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 300 }, deviceScaleFactor: 1 });
    await page.route("http://pdfjs.local/**", (r: any) => {
      const f = String(r.request().url()).split("/").pop();
      if (f === "index.html") return r.fulfill({ body: "<html></html>", contentType: "text/html" });
      return r.fulfill({ body: readFileSync(join(PDFJS_BUILD, f ?? "")), contentType: "text/javascript" });
    });
    await page.goto("http://pdfjs.local/index.html");
    await page.setContent(`<html><head><style>${docFontFaceCss()} body{margin:0;background:#fff}</style></head><body><span style="font-family:Noto Sans Devanagari">कुल</span></body></html>`);
    const arg = JSON.stringify({ words: WORDS, b64: Buffer.from(pdf).toString("base64") });
    return (await page.evaluate(`(${IN_BROWSER})(${arg})`)) as Shape[];
  } finally {
    await browser.close();
  }
}

describe("Devanagari shaping in issued PDFs (raster vs Chromium text)", () => {
  it("every mark matches Chromium text within 6 px at 96 px (0.22 em = ~21 px)", async () => {
    const shapes = await compareWithChromiumText(await chromiumWordsPdf());
    console.info("[shaping] chromium path", JSON.stringify(shapes.map((s) => [s.word, +s.dTop.toFixed(1), +s.dBot.toFixed(1), s.dW])));
    for (const s of shapes) {
      expect.soft(s.dTop, `${s.word} above-base marks`).toBeLessThanOrEqual(TOL_PX);
      expect.soft(s.dBot, `${s.word} below-base marks`).toBeLessThanOrEqual(TOL_PX);
      expect.soft(s.dW, `${s.word} ink width`).toBeLessThanOrEqual(WIDTH_TOL_PX);
    }
  }, 120_000);

  it("negative control: the same check flags the pdf-lib (no GPOS) rendering of के and कुल", async () => {
    const shapes = await compareWithChromiumText(await pdfLibWordsPdf());
    console.info("[shaping] pdf-lib control", JSON.stringify(shapes.map((s) => [s.word, +s.dTop.toFixed(1), +s.dBot.toFixed(1), s.dW])));
    const ke = shapes.find((s) => s.word === "के")!;
    const kul = shapes.find((s) => s.word === "कुल")!;
    expect(Math.max(ke.dTop, ke.dBot)).toBeGreaterThan(TOL_PX * 2);
    expect(Math.max(kul.dTop, kul.dBot)).toBeGreaterThan(TOL_PX * 2);
    // the 0.22 em class of defect is caught on every affected word, not just the two named ones
    expect(shapes.filter((s) => Math.max(s.dTop, s.dBot) > TOL_PX).length).toBeGreaterThanOrEqual(4);
  }, 120_000);
});

describe("issued PDF text layer and fonts", () => {
  it("copied text is in logical order (कार्यालय, not कायार्लय) and the fonts are embedded", async () => {
    const pdf = await OfficialPdf.create({ title: "copy test", lang: "hi", generatedAt: new Date("2026-11-04T07:00:00Z") });
    pdf.title("Office Order", "कार्यालय आदेश").paragraph("स्वीकृति आदेश — कुल कटौतियाँ — केंद्रीय कृषि मंत्रालय");
    const bytes = await pdf.save();
    const text = await pdfFlatText(bytes);
    expect(text).toContain("कार्यालय आदेश");
    expect(text).not.toContain("कायार्लय");
    expect(text).toContain("स्वीकृति आदेश");
    expect(text).toContain("कुल कटौतियाँ");
    expect(text).toContain("केंद्रीय कृषि मंत्रालय");
    const fonts = await pdfFonts(bytes);
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  }, 60_000);

  it("renders documents concurrently on the shared browser, each under 3 s", async () => {
    const one = async (i: number) => {
      const t0 = Date.now();
      const pdf = await OfficialPdf.create({ title: `perf ${i}`, footerNote: `Doc ${i}` });
      pdf.letterhead({ orgNameHi: "भारत सरकार", orgName: "Government of India" }).title("Sanction Order", "स्वीकृति आदेश")
        .table({ columns: [{ header: "S. No.", width: 1 }, { header: "Item", width: 5 }], rows: Array.from({ length: 60 }, (_, k) => [String(k + 1), `मद ${k + 1} item`]) });
      const bytes = await pdf.save();
      return { ms: Date.now() - t0, size: bytes.length };
    };
    await one(-1); // warm the shared browser
    const runs = await Promise.all([0, 1, 2, 3, 4, 5].map(one));
    console.info("[perf] ms per document", runs.map((r) => r.ms).join(", "));
    for (const r of runs) expect(r.ms).toBeLessThan(3000);
  }, 120_000);
});
