import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrChain } from "../src/chain.js";
import { OcrInputError } from "../src/errors.js";
import { DEFAULT_MAX_IMAGE_SIZE, DEFAULT_MAX_PIXELS, PdfSource } from "../src/preprocess/index.js";
import { processDocument, processDocumentStream, type ProcessedPage } from "../src/process.js";
import { fakeProvider, pageResult, syntheticTextPng } from "./helpers.js";

const NO_ORIENT = { orientationDetector: null } as const;

async function scannedPdf(nPages: number, size: [number, number] = [300, 400]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(await syntheticTextPng({ width: 600, height: 800 }));
  for (let i = 0; i < nPages; i++) {
    const p = doc.addPage(size);
    p.drawImage(png, { x: 0, y: 0, width: size[0], height: size[1] });
  }
  return doc.save();
}

function recorder() {
  const events: string[] = [];
  const provider = fakeProvider("tesseract", (_c, ps) => {
    events.push(`ocr:${ps.map((p) => p.pageNumber).join(",")}`);
    return ps.map((p) => pageResult(p, 0.9, "tesseract", `page ${p.pageNumber}`));
  });
  return { events, provider, chain: new OcrChain({ providers: [{ provider }], langs: ["eng"] }) };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("processDocumentStream: one page at a time", () => {
  it("rasterises, preprocesses and OCRs page N before rasterising page N+1", async () => {
    const { events, chain } = recorder();
    const orig = PdfSource.prototype.renderPage;
    vi.spyOn(PdfSource.prototype, "renderPage").mockImplementation(function (this: PdfSource, n, o) {
      events.push(`render:${n}`);
      return orig.call(this, n, o);
    });
    const yielded: number[] = [];
    for await (const page of processDocumentStream({ data: await scannedPdf(3) }, { chain, ...NO_ORIENT, pageConcurrency: 1 })) {
      events.push(`yield:${page.image.pageNumber}`);
      yielded.push(page.result.pageNumber);
      expect(page.result.text).toBe(`page ${page.image.pageNumber}`);
    }
    expect(yielded).toEqual([1, 2, 3]);
    expect(events).toEqual(["render:1", "ocr:1", "yield:1", "render:2", "ocr:2", "yield:2", "render:3", "ocr:3", "yield:3"]);
  }, 60_000);

  it("processDocument still returns every page image by default; retainImages:false drops them but keeps results", async () => {
    const { chain } = recorder();
    const data = await scannedPdf(3);
    const seen: ProcessedPage[] = [];
    const kept = await processDocument({ data }, { chain, ...NO_ORIENT, onPage: (p) => { seen.push(p); } });
    expect(kept.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(kept.reports).toHaveLength(3);
    expect(seen).toHaveLength(3);
    const lean = await processDocument({ data }, { chain, ...NO_ORIENT, retainImages: false });
    expect(lean.pages).toEqual([]);
    expect(lean.result.pageCount).toBe(3);
    expect(lean.result.text).toBe(kept.result.text);
    expect(lean.result.diagnostics?.[0]).toMatchObject({ providerId: "tesseract", outcome: "ok", pages: [1, 2, 3] });
  }, 60_000);

  it("closes the pdf when the consumer stops early or onPage throws", async () => {
    const { chain } = recorder();
    const data = await scannedPdf(3);
    const closeSpy = vi.spyOn(PdfSource.prototype, "close");
    for await (const _p of processDocumentStream({ data }, { chain, ...NO_ORIENT })) break;
    expect(closeSpy).toHaveBeenCalledTimes(1);
    await expect(processDocument({ data }, { chain, ...NO_ORIENT, onPage: () => { throw new Error("sink full"); } })).rejects.toThrow("sink full");
    expect(closeSpy).toHaveBeenCalledTimes(2);
  }, 60_000);
});

describe("abort between pages", () => {
  it("stops promptly: no further page is rendered after the signal fires", async () => {
    const { events, chain } = recorder();
    const renderSpy = vi.spyOn(PdfSource.prototype, "renderPage");
    const ac = new AbortController();
    const err = await processDocument(
      { data: await scannedPdf(4) },
      { chain, ...NO_ORIENT, pageConcurrency: 1, signal: ac.signal, onPage: (p) => { if (p.image.pageNumber === 2) ac.abort(); } },
    ).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["ocr:1", "ocr:2"]);
  }, 60_000);

  it("an already-aborted signal renders nothing", async () => {
    const { chain, provider } = recorder();
    const renderSpy = vi.spyOn(PdfSource.prototype, "renderPage");
    const ac = new AbortController();
    ac.abort();
    await expect(processDocument({ data: await scannedPdf(2) }, { chain, ...NO_ORIENT, signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(renderSpy).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  }, 60_000);
});

describe("page cap is enforced before any page is allocated", () => {
  it("PDF over maxPages: TOO_MANY_PAGES, nothing rasterised, nothing OCRed", async () => {
    const { chain, provider } = recorder();
    const renderSpy = vi.spyOn(PdfSource.prototype, "renderPage");
    const err = await processDocument({ data: await scannedPdf(5) }, { chain, maxPages: 4, ...NO_ORIENT }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrInputError);
    expect((err as OcrInputError).code).toBe("TOO_MANY_PAGES");
    expect(renderSpy).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  }, 60_000);

  it("multipage TIFF over maxPages: TOO_MANY_PAGES, no page decoded or OCRed", async () => {
    const one = await sharp(await syntheticTextPng({ width: 120, height: 80 })).greyscale().raw().toBuffer();
    const tiff = await sharp(Buffer.concat([one, one, one]), { raw: { width: 120, height: 240, channels: 1, pageHeight: 80 } }).tiff().toBuffer();
    const { chain, provider } = recorder();
    const gen = processDocumentStream({ data: tiff }, { chain, maxPages: 2, ...NO_ORIENT });
    const err = await gen.next().catch((e: unknown) => e);
    expect((err as OcrInputError).code).toBe("TOO_MANY_PAGES");
    expect(provider.calls).toHaveLength(0);
  });
});

describe("maxPixels / maxImageSize", () => {
  it("defaults are 25 MP and 40 MP", () => {
    expect(DEFAULT_MAX_PIXELS).toBe(25_000_000);
    expect(DEFAULT_MAX_IMAGE_SIZE).toBe(40_000_000);
  });

  it("downscales a PDF page above maxPixels and reports it on the page metadata", async () => {
    const { chain } = recorder();
    const data = await scannedPdf(1, [595, 842]); // A4 at 300 dpi = 2479x3508 = 8.7 MP
    const full = await processDocument({ data }, { chain, ...NO_ORIENT, preprocess: { cropBorder: false } });
    expect(full.pages[0]!.dpi).toBe(300);
    expect(full.result.pages[0]?.metadata?.render_downscaled).toBeUndefined();
    const cap = 1_000_000;
    const small = await processDocument({ data }, { chain, ...NO_ORIENT, maxPixels: cap, preprocess: { cropBorder: false } });
    const img = small.pages[0]!;
    expect(img.width * img.height).toBeLessThanOrEqual(cap);
    expect(img.dpi).toBeLessThan(300);
    expect(small.result.pages[0]?.metadata).toMatchObject({ render_downscaled: true, render_requested_dpi: 300, render_dpi: img.dpi });
  }, 60_000);

  it("passes maxPixels / maxImageSize through to the PDF source", async () => {
    const { chain } = recorder();
    const openSpy = vi.spyOn(PdfSource, "open");
    const renderSpy = vi.spyOn(PdfSource.prototype, "renderPage");
    await processDocument({ data: await scannedPdf(1) }, { chain, ...NO_ORIENT, maxPixels: 123_456, maxImageSize: 7_000_000 });
    expect(openSpy.mock.calls[0]?.[1]).toEqual({ maxImageSize: 7_000_000 });
    expect(renderSpy.mock.calls[0]?.[1]).toMatchObject({ maxPixels: 123_456 });
  }, 60_000);

  it("downscales an oversized raster image too", async () => {
    const { chain } = recorder();
    const png = await syntheticTextPng({ width: 1600, height: 1200 });
    const out = await processDocument({ data: png }, { chain, ...NO_ORIENT, maxPixels: 500_000, preprocess: { cropBorder: false } });
    const img = out.pages[0]!;
    expect(img.width * img.height).toBeLessThanOrEqual(500_000);
    expect(out.result.pages[0]?.metadata?.render_downscaled).toBe(true);
  });
});

describe("pageConcurrency: bounded window, results in page order", () => {
  /** Chain whose OCR takes a while and records the max number of pages in OCR at once. */
  function slowChain(delays: (n: number) => number, waitForOverlap = false) {
    let active = 0;
    let maxActive = 0;
    const provider = fakeProvider("tesseract", async (_c, ps) => {
      active++; maxActive = Math.max(maxActive, active);
      if (waitForOverlap) {
        // Deterministic overlap: hold every page until a second page is in OCR (10 s safety cap). A fixed sleep
        // raced page rendering on a loaded CI host, so a second page was never in flight and max() stayed 1.
        const deadline = Date.now() + 10_000;
        while (maxActive < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
      }
      await new Promise((r) => setTimeout(r, delays(ps[0]!.pageNumber)));
      active--;
      return ps.map((p) => pageResult(p, 0.9, "tesseract", `page ${p.pageNumber}`));
    });
    return { chain: new OcrChain({ providers: [{ provider }], langs: ["eng"] }), max: () => maxActive };
  }

  it("default window is 2: OCR overlaps (pool is used again) but never exceeds the window; order is preserved even when page 1 is slowest", async () => {
    // Deterministic overlap: page 1's OCR does not finish until page 2's OCR has STARTED (10 s safety cap). A fixed
    // sleep raced the page-2 render on a loaded host. If pages stop overlapping, page 1 times out and max() stays 1.
    let page2Started!: () => void;
    const page2 = new Promise<void>((r) => { page2Started = r; });
    let active = 0;
    let maxActive = 0;
    const provider = fakeProvider("tesseract", async (_c, ps) => {
      const n = ps[0]!.pageNumber;
      active++; maxActive = Math.max(maxActive, active);
      if (n === 2) page2Started();
      if (n === 1) await Promise.race([page2, new Promise((r) => setTimeout(r, 10_000))]);
      else await new Promise((r) => setTimeout(r, 10));
      active--;
      return ps.map((p) => pageResult(p, 0.9, "tesseract", `page ${p.pageNumber}`));
    });
    const chain = new OcrChain({ providers: [{ provider }], langs: ["eng"] });
    const max = () => maxActive;
    const order: number[] = [];
    const out = await processDocument({ data: await scannedPdf(5) }, { chain, ...NO_ORIENT, onPage: (p) => { order.push(p.image.pageNumber); } });
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(out.result.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(max()).toBe(2);
  }, 60_000);

  it("pageConcurrency 1 is strictly sequential; 3 never exceeds 3; invalid values clamp to 1", async () => {
    for (const [conc, lo, hi] of [[1, 1, 1], [3, 2, 3], [0, 1, 1], [-4, 1, 1]] as const) {
      const { chain, max } = slowChain(() => 400, conc === 3);
      await processDocument({ data: await scannedPdf(5) }, { chain, ...NO_ORIENT, pageConcurrency: conc });
      expect(max()).toBeGreaterThanOrEqual(lo);
      expect(max()).toBeLessThanOrEqual(hi);
    }
  }, 60_000);

  it("never more than pageConcurrency rasterised pages are alive (rendered but not yet released by the consumer)", async () => {
    const { chain } = slowChain(() => 20);
    let alive = 0;
    let maxAlive = 0;
    const orig = PdfSource.prototype.renderPage;
    vi.spyOn(PdfSource.prototype, "renderPage").mockImplementation(async function (this: PdfSource, n, o) {
      const r = await orig.call(this, n, o);
      alive++; maxAlive = Math.max(maxAlive, alive);
      return r;
    });
    const seen: number[] = [];
    for await (const page of processDocumentStream({ data: await scannedPdf(6) }, { chain, ...NO_ORIENT, pageConcurrency: 2 })) {
      seen.push(page.image.pageNumber);
      await new Promise((r) => setTimeout(r, 30)); // slow consumer: nothing new may start meanwhile
      alive--; // consumer releases the page
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(maxAlive).toBeLessThanOrEqual(2);
  }, 60_000);

  it("abort is checked before each page starts: at most the window is rendered after the abort", async () => {
    const { chain } = slowChain(() => 20);
    const renderSpy = vi.spyOn(PdfSource.prototype, "renderPage");
    const ac = new AbortController();
    const err = await processDocument({ data: await scannedPdf(8) }, { chain, ...NO_ORIENT, signal: ac.signal, onPage: (p) => { if (p.image.pageNumber === 1) ac.abort(); } }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(renderSpy.mock.calls.length).toBeLessThanOrEqual(3);
  }, 60_000);

  it("an OCR failure on one page surfaces and the pdf is still closed", async () => {
    const provider = fakeProvider("tesseract", async (_c, ps) => { if (ps[0]!.pageNumber === 2) throw new Error("boom"); return ps.map((p) => pageResult(p, 0.9)); });
    const chain = new OcrChain({ providers: [{ provider, maxAttempts: 1 }], langs: ["eng"] });
    const closeSpy = vi.spyOn(PdfSource.prototype, "close");
    await expect(processDocument({ data: await scannedPdf(4) }, { chain, ...NO_ORIENT })).rejects.toThrow();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  }, 60_000);
});
