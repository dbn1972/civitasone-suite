/**
 * processDocument: bytes in -> DocumentOcrResult + preprocessed page images out.
 * Type is detected from MAGIC BYTES (claimed MIME/extension is ignored), PDFs are rasterised (and their
 * embedded text layer used instead of OCR when good), pages are preprocessed, then run through the chain.
 *
 * MEMORY MODEL: pages are processed ONE AT A TIME (rasterise -> preprocess -> OCR chain), so peak memory is
 * a single page's working set (bounded by `maxPixels`), not pages x page-size. `processDocumentStream`
 * yields each finished page and keeps nothing; `processDocument` is a collector over it. By default
 * (`retainImages: true`, the historical behaviour) it still returns every preprocessed page image (needed
 * for the searchable PDF and the review viewer): that costs ~ pageCount x PNG size. Callers that only need
 * text/fields can set `retainImages: false` (and/or pass `onPage` to persist each page as it completes);
 * `pages` is then empty. The page-count cap is enforced before any page is rasterised/decoded.
 */
import { OcrInputError } from "./errors.js";
import { assembleDocumentResult, type OcrChain } from "./chain.js";
import {
  DEFAULT_MAX_IMAGE_SIZE, DEFAULT_MAX_PIXELS, DEFAULT_PREPROCESS, DEFAULT_TEXT_LAYER, PdfSource, TesseractOsdDetector,
  detectInputKind, imagePageCount, preprocessImage, readImagePage, toPageImage,
} from "./preprocess/index.js";
import type { InputKind, OrientationDetector, PreprocessConfig, PreprocessReport, TextLayerConfig } from "./preprocess/index.js";
import type { DocumentOcrResult, PageImage, PageResult, ProviderAttemptDiagnostic } from "./types.js";

export interface ProcessDocumentConfig {
  chain: OcrChain;
  preprocess?: Partial<PreprocessConfig>;
  textLayer?: Partial<TextLayerConfig>;
  /** Hard page cap (default 200) => OcrInputError TOO_MANY_PAGES, checked BEFORE any page is rasterised. */
  maxPages?: number;
  /**
   * Max pixel area of one rasterised page (default 25 MP, ~100 MB RGBA canvas; A3 at 300 DPI is ~17 MP so
   * legitimate scans fit). Larger pages are scaled down; the downscale is reported on the page metadata
   * (`render_downscaled`, `render_requested_dpi`, `render_dpi`).
   */
  maxPixels?: number;
  /**
   * Pages processed concurrently (default 2 = the tesseract provider's default `maxWorkers`, min 1). Memory is
   * bounded by this: at most this many rasterised pages are alive at once.
   */
  pageConcurrency?: number;
  /** pdfjs `maxImageSize`: max pixels of one embedded PDF image (default 40 MP). */
  maxImageSize?: number;
  /** undefined = shared lazy tesseract-OSD detector; null = no orientation detection. */
  orientationDetector?: OrientationDetector | null;
  signal?: AbortSignal;
  /** Called with each page as soon as it is fully processed (before the next page is rasterised). */
  onPage?: (page: ProcessedPage) => void | Promise<void>;
  /** Keep every preprocessed page image in the returned `pages` (default true). false => `pages` is []. */
  retainImages?: boolean;
}

/** One finished page: the image exactly as seen by OCR plus its result and preprocessing report. */
export interface ProcessedPage {
  image: PageImage;
  result: PageResult;
  /** null for text-layer pages, which are kept as the raw render. */
  report: PreprocessReport | null;
}

export interface ProcessedDocument {
  kind: InputKind;
  result: DocumentOcrResult;
  /** Page images exactly as seen by OCR (preprocessed); coordinates in `result` refer to these. Empty when `retainImages: false`. */
  pages: PageImage[];
  /** Per-page preprocessing report (null for text-layer pages, which are kept as the raw render). */
  reports: Array<PreprocessReport | null>;
}

/** Return value of the `processDocumentStream` generator (read it from the final `next()`). */
export interface ProcessStreamSummary {
  kind: InputKind;
  pageCount: number;
  diagnostics: ProviderAttemptDiagnostic[] | undefined;
}

let sharedDetector: TesseractOsdDetector | null = null;
export async function disposeDefaultOrientationDetector(): Promise<void> {
  const d = sharedDetector;
  sharedDetector = null;
  if (d) await d.dispose();
}

interface RenderInfo { downscaled: boolean; requestedDpi: number; dpi: number }

function withRenderMeta(page: PageResult, r: RenderInfo): PageResult {
  if (!r.downscaled) return page;
  return { ...page, metadata: { ...page.metadata, render_downscaled: true, render_requested_dpi: r.requestedDpi, render_dpi: r.dpi } };
}

/** Folds per-page chain diagnostics into one trail (same provider+outcome => attempts summed, pages joined). */
function mergeDiagnostics(into: ProviderAttemptDiagnostic[], add: readonly ProviderAttemptDiagnostic[]): void {
  for (const d of add) {
    const cur = into.find((x) => x.providerId === d.providerId && x.outcome === d.outcome);
    if (!cur) { into.push({ ...d, ...(d.pages ? { pages: [...d.pages] } : {}) }); continue; }
    cur.attempts += d.attempts;
    if (d.pages) cur.pages = [...(cur.pages ?? []), ...d.pages];
    if (d.error && !cur.error) cur.error = d.error;
  }
}

/** Default window of pages in flight = the tesseract provider's default worker-pool size (maxWorkers: 2). */
export const DEFAULT_PAGE_CONCURRENCY = 2;

/**
 * Streaming pipeline: yields each page as soon as it is processed, IN PAGE ORDER, and holds nothing else, so the
 * caller controls retention. Up to `pageConcurrency` (default 2, min 1) pages are in flight at once so the
 * tesseract worker pool stays busy; a new page is only started after the oldest in-flight page was yielded, so
 * never more than `pageConcurrency` rasterised pages are alive (including the one the consumer is holding).
 * Consume with `for await`; to read the summary (kind, merged diagnostics) drive the generator manually or use
 * `processDocument`. Abort (`cfg.signal`) is checked before starting every page.
 */
export async function* processDocumentStream(
  input: { data: Uint8Array; mimeType?: string },
  cfg: ProcessDocumentConfig,
): AsyncGenerator<ProcessedPage, ProcessStreamSummary, void> {
  const kind = detectInputKind(input.data);
  const pre: PreprocessConfig = { ...DEFAULT_PREPROCESS, ...cfg.preprocess };
  const textCfg: TextLayerConfig = { ...DEFAULT_TEXT_LAYER, ...cfg.textLayer };
  const maxPages = cfg.maxPages ?? 200;
  const maxPixels = cfg.maxPixels ?? DEFAULT_MAX_PIXELS;
  const window = Math.max(1, Math.floor(cfg.pageConcurrency ?? DEFAULT_PAGE_CONCURRENCY));
  const detector = cfg.orientationDetector === undefined
    ? (pre.autoOrient ? (sharedDetector ??= new TesseractOsdDetector()) : null)
    : cfg.orientationDetector;
  // per-page chain diagnostics, folded in PAGE order at the end so the trail never depends on completion order
  const perPage = new Map<number, readonly ProviderAttemptDiagnostic[]>();
  let sawOcr = false;
  let count = 0;

  /** OCR one preprocessed page through the chain (one page per call: bounded memory). */
  const ocr = async (image: PageImage, report: PreprocessReport): Promise<PageResult> => {
    const r = await cfg.chain.recognize([image], cfg.signal ? { signal: cfg.signal } : {});
    sawOcr = true;
    if (r.diagnostics) perPage.set(image.pageNumber, r.diagnostics);
    const page = r.pages[0];
    if (!page) throw new OcrInputError("CORRUPT", `OCR returned no result for page ${image.pageNumber}`);
    return report.orientationDetected ? { ...page, orientationDeg: report.rotationDeg } : page;
  };

  /** Runs `task(n)` for n = 1..total with at most `window` in flight, yielding results in page order. */
  async function* windowed(total: number, task: (n: number) => Promise<ProcessedPage>): AsyncGenerator<ProcessedPage, void, void> {
    const inflight: Promise<ProcessedPage>[] = [];
    try {
      for (let n = 1; n <= total; n++) {
        cfg.signal?.throwIfAborted();
        if (inflight.length >= window) { const done = await (inflight.shift() as Promise<ProcessedPage>); count++; yield done; }
        cfg.signal?.throwIfAborted();
        const p = task(n);
        p.catch(() => undefined); // never an unhandled rejection; the error surfaces when the page is awaited
        inflight.push(p);
      }
      while (inflight.length > 0) { const done = await (inflight.shift() as Promise<ProcessedPage>); count++; yield done; }
    } finally {
      await Promise.allSettled(inflight); // let in-flight pages finish before the caller closes the source
    }
  }

  if (kind === "pdf") {
    const pdf = await PdfSource.open(input.data, { maxImageSize: cfg.maxImageSize ?? DEFAULT_MAX_IMAGE_SIZE });
    try {
      // Caps are checked on the page COUNT from the PDF page tree, before any page is rendered.
      if (pdf.pageCount > maxPages) throw new OcrInputError("TOO_MANY_PAGES", `Document has ${pdf.pageCount} pages; the limit is ${maxPages}`);
      if (pdf.pageCount < 1) throw new OcrInputError("CORRUPT", "PDF has no pages");
      let renderLock: Promise<unknown> = Promise.resolve(); // pdfjs renders are serialised; OCR of earlier pages overlaps
      const render = (n: number): Promise<Awaited<ReturnType<PdfSource["renderPage"]>>> => {
        const run = renderLock.then(() => { cfg.signal?.throwIfAborted(); return pdf.renderPage(n, { dpi: pre.dpi, maxPixels, textLayer: textCfg }); });
        renderLock = run.catch(() => undefined);
        return run;
      };
      yield* windowed(pdf.pageCount, async (n) => {
        const r = await render(n);
        const info: RenderInfo = { downscaled: r.downscaled, requestedDpi: r.requestedDpi, dpi: r.dpi };
        if (r.textLayer) {
          return {
            image: { pageNumber: n, data: r.png, mimeType: "image/png", width: r.width, height: r.height, dpi: r.dpi },
            result: withRenderMeta(r.textLayer, info), report: null,
          };
        }
        const p = await preprocessImage(r.png, pre, detector);
        const image: PageImage = { pageNumber: n, data: p.data, mimeType: "image/png", width: p.width, height: p.height, dpi: r.dpi };
        cfg.signal?.throwIfAborted();
        return { image, result: withRenderMeta(await ocr(image, p.report), info), report: p.report };
      });
    } finally {
      await pdf.close();
    }
  } else {
    const total = await imagePageCount(input.data);
    if (total > maxPages) throw new OcrInputError("TOO_MANY_PAGES", `Document has ${total} pages; the limit is ${maxPages}`);
    yield* windowed(total, async (n) => {
      const r = await readImagePage(input.data, n - 1, pre.dpi, maxPixels);
      const p = await preprocessImage(r.png, pre, detector);
      const image: PageImage = { pageNumber: n, data: p.data, mimeType: "image/png", width: p.width, height: p.height, dpi: r.dpi };
      cfg.signal?.throwIfAborted();
      const result = withRenderMeta(await ocr(image, p.report), { downscaled: r.downscaled, requestedDpi: r.requestedDpi, dpi: r.dpi });
      return { image, result, report: p.report };
    });
  }
  const diagnostics: ProviderAttemptDiagnostic[] = [];
  for (const n of [...perPage.keys()].sort((a, b) => a - b)) mergeDiagnostics(diagnostics, perPage.get(n) ?? []);
  for (const d of diagnostics) if (d.pages) d.pages.sort((a, b) => a - b);
  return { kind, pageCount: count, diagnostics: sawOcr ? diagnostics : undefined };
}

export async function processDocument(
  input: { data: Uint8Array; mimeType?: string },
  cfg: ProcessDocumentConfig,
): Promise<ProcessedDocument> {
  const retain = cfg.retainImages ?? true;
  const images: PageImage[] = [];
  const reports: Array<PreprocessReport | null> = [];
  const results: PageResult[] = [];
  const gen = processDocumentStream(input, cfg);
  let summary: ProcessStreamSummary;
  try {
    for (;;) {
      const step = await gen.next();
      if (step.done) { summary = step.value; break; }
      const page = step.value;
      results.push(page.result);
      reports.push(page.report);
      if (retain) images.push(page.image);
      if (cfg.onPage) await cfg.onPage(page);
    }
  } finally {
    // an onPage failure must still run the generator's cleanup (closes the pdfjs document)
    await gen.return({ kind: "png", pageCount: 0, diagnostics: undefined });
  }
  return { kind: summary.kind, result: assembleDocumentResult(results, summary.diagnostics), pages: images, reports };
}

export { toPageImage };
