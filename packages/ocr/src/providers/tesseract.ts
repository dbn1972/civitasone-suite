/**
 * Local OCR provider: tesseract.js 5.1.1 (WASM; there is no system tesseract binary on our hosts).
 *
 * - Worker pool with a hard concurrency bound (`maxWorkers`); workers are created lazily and
 *   re-initialised to another language set when the pool is full (no extra WASM instance).
 * - Language data is loaded lazily per worker. Source = `OCR_TESSDATA_PATH` (local directory or
 *   http(s) URL holding `<lang>.traineddata[.gz]`); downloads are cached on local disk under
 *   `OCR_TESSDATA_CACHE` (default <tmpdir>/civitasone-ocr-tessdata). Nothing large is committed.
 *   With no source configured tesseract.js falls back to its public CDN (needs internet).
 * - Missing data raises an OcrProviderError that names the language(s).
 */
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { detectScript } from "../script.js";
import { mapLimit, normaliseLangs } from "../port.js";
import {
  OcrProviderError,
  type BBox, type OcrBlock, type OcrLang, type OcrLine, type OcrProvider, type OcrWord,
  type PageImage, type PageResult, type RecognizeOptions,
} from "../types.js";

/* ---- minimal structural view of tesseract.js (lets tests inject a fake) ---------------- */
export interface TessWordLike { text: string; confidence: number; bbox: BBox }
export interface TessLineLike { text: string; confidence: number; bbox: BBox; words: TessWordLike[] }
export interface TessParagraphLike { lines: TessLineLike[] }
export interface TessBlockLike { text: string; confidence: number; bbox: BBox; paragraphs: TessParagraphLike[] }
export interface TessPageLike { text: string; confidence: number; blocks: TessBlockLike[] | null }
export interface TessWorkerLike {
  recognize(image: Uint8Array, options?: Record<string, unknown>, output?: Record<string, unknown>): Promise<{ data: TessPageLike }>;
  reinitialize(langs: string): Promise<unknown>;
  setParameters?(params: Record<string, unknown>): Promise<unknown>;
  terminate(): Promise<unknown>;
}
export interface TessWorkerOptions { langPath?: string; cachePath: string; gzip: boolean }
export type TessWorkerFactory = (langs: string, opts: TessWorkerOptions) => Promise<TessWorkerLike>;

export interface TesseractProviderConfig {
  /** Max concurrent WASM workers (also max concurrent recognitions). Default 2. */
  maxWorkers?: number;
  /** Local directory or http(s) URL with `<lang>.traineddata[.gz]`. Default: env OCR_TESSDATA_PATH. */
  tessdataPath?: string;
  /** Local cache dir for downloaded data. Default: env OCR_TESSDATA_CACHE or <tmpdir>/civitasone-ocr-tessdata. */
  cacheDir?: string;
  /** Terminate workers idle for this long (0 = keep alive until dispose). Default 30000. */
  idleTimeoutMs?: number;
  /** Tesseract page segmentation mode (string, e.g. "3" auto). Default tesseract.js default. */
  psm?: string;
  /** Test seam: replaces the real tesseract.js createWorker. */
  workerFactory?: TessWorkerFactory;
  env?: Record<string, string | undefined>;
}

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const defaultFactory: TessWorkerFactory = async (langs, opts) => {
  const mod = (await import("tesseract.js")) as unknown as {
    createWorker?: (l: string, oem: number, o: Record<string, unknown>) => Promise<TessWorkerLike>;
    default?: { createWorker: (l: string, oem: number, o: Record<string, unknown>) => Promise<TessWorkerLike> };
  };
  const create = mod.createWorker ?? mod.default?.createWorker;
  if (!create) throw new Error("tesseract.js createWorker not found");
  const o: Record<string, unknown> = { cachePath: opts.cachePath, gzip: opts.gzip };
  if (opts.langPath) o.langPath = opts.langPath;
  return create(langs, 1 /* LSTM_ONLY */, o);
};

interface PoolWorker { w: TessWorkerLike; key: string; busy: boolean; idleTimer: NodeJS.Timeout | null }

export class TesseractProvider implements OcrProvider {
  readonly id = "tesseract" as const;
  private readonly maxWorkers: number;
  private readonly tessdataPath: string | undefined;
  private readonly cacheDir: string;
  private readonly idleTimeoutMs: number;
  private readonly psm: string | undefined;
  private readonly factory: TessWorkerFactory;
  private readonly workers: PoolWorker[] = [];
  private creating = 0;
  private readonly waiters: Array<() => void> = [];
  private disposed = false;

  constructor(cfg: TesseractProviderConfig = {}) {
    const env = cfg.env ?? process.env;
    this.maxWorkers = Math.max(1, cfg.maxWorkers ?? 2);
    this.tessdataPath = cfg.tessdataPath ?? env.OCR_TESSDATA_PATH ?? undefined;
    this.cacheDir = cfg.cacheDir ?? env.OCR_TESSDATA_CACHE ?? join(tmpdir(), "civitasone-ocr-tessdata");
    this.idleTimeoutMs = cfg.idleTimeoutMs ?? 30_000;
    this.psm = cfg.psm;
    this.factory = cfg.workerFactory ?? defaultFactory;
  }

  /** Live worker count (tests / metrics). */
  get workerCount(): number { return this.workers.length + this.creating; }

  async isAvailable(): Promise<boolean> { return !this.disposed; }

  /** Resolves whether `<lang>.traineddata[.gz]` is readable; for URL/CDN sources it is assumed present. */
  private async resolveData(langs: OcrLang[]): Promise<{ gzip: boolean }> {
    const dir = this.tessdataPath;
    if (!dir || isUrl(dir)) return { gzip: true };
    const gz: boolean[] = [];
    for (const l of langs) {
      if (await exists(join(dir, `${l}.traineddata.gz`))) gz.push(true);
      else if (await exists(join(dir, `${l}.traineddata`))) gz.push(false);
      else throw new OcrProviderError("tesseract", `Tesseract traineddata for language "${l}" is unavailable in ${dir} (expected ${l}.traineddata or ${l}.traineddata.gz)`, false);
    }
    if (new Set(gz).size > 1) {
      throw new OcrProviderError("tesseract", `Tesseract traineddata in ${dir} mixes gzipped and plain files for languages ${langs.join("+")}; use one format`, false);
    }
    return { gzip: gz[0] ?? true };
  }

  async recognize(pages: PageImage[], opts: RecognizeOptions): Promise<PageResult[]> {
    if (this.disposed) throw new OcrProviderError("tesseract", "Tesseract provider has been disposed", false);
    const langs = normaliseLangs(opts.langs);
    const key = langs.join("+");
    const { gzip } = await this.resolveData(langs);
    return mapLimit(pages, this.maxWorkers, async (page) => {
      if (opts.signal?.aborted) throw new OcrProviderError("tesseract", "aborted", false);
      const t0 = performance.now();
      const pw = await this.acquire(key, gzip);
      let data: TessPageLike;
      const r0 = performance.now();
      try {
        if (this.psm) await pw.w.setParameters?.({ tessedit_pageseg_mode: this.psm });
        data = (await pw.w.recognize(page.data, {}, { blocks: true, text: true })).data;
      } catch (err) {
        await this.discard(pw);
        throw new OcrProviderError("tesseract", `Tesseract failed on page ${page.pageNumber} (langs ${key}): ${err instanceof Error ? err.message : String(err)}`, true);
      }
      this.release(pw);
      const t1 = performance.now();
      return toPageResult(page, data, { totalMs: Math.round(t1 - t0), recognizeMs: Math.round(t1 - r0) });
    });
  }

  /* ---------------- pool ---------------- */
  private async acquire(key: string, gzip: boolean): Promise<PoolWorker> {
    for (;;) {
      if (this.disposed) throw new OcrProviderError("tesseract", "Tesseract provider has been disposed", false);
      const same = this.workers.find((w) => !w.busy && w.key === key);
      if (same) return this.take(same);
      if (this.workers.length + this.creating < this.maxWorkers) return this.create(key, gzip);
      const other = this.workers.find((w) => !w.busy);
      if (other) {
        this.take(other);
        try {
          await other.w.reinitialize(key);
          other.key = key;
          return other;
        } catch (err) {
          await this.discard(other);
          throw new OcrProviderError("tesseract", `Failed to load traineddata for language(s) ${key}: ${err instanceof Error ? err.message : String(err)}`, true);
        }
      }
      await new Promise<void>((resolve) => { this.waiters.push(resolve); });
    }
  }

  private take(pw: PoolWorker): PoolWorker {
    pw.busy = true;
    if (pw.idleTimer) { clearTimeout(pw.idleTimer); pw.idleTimer = null; }
    return pw;
  }

  private async create(key: string, gzip: boolean): Promise<PoolWorker> {
    this.creating++;
    try {
      const w = await this.factory(key, { ...(this.tessdataPath ? { langPath: this.tessdataPath } : {}), cachePath: this.cacheDir, gzip });
      const pw: PoolWorker = { w, key, busy: true, idleTimer: null };
      this.workers.push(pw);
      return pw;
    } catch (err) {
      this.wake();
      throw new OcrProviderError("tesseract", `Failed to load traineddata for language(s) ${key} from ${this.tessdataPath ?? "tesseract.js default CDN"}: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      this.creating--;
    }
  }

  private release(pw: PoolWorker): void {
    pw.busy = false;
    if (this.idleTimeoutMs > 0) {
      pw.idleTimer = setTimeout(() => { void this.discard(pw); }, this.idleTimeoutMs);
      pw.idleTimer.unref();
    }
    this.wake();
  }

  private async discard(pw: PoolWorker): Promise<void> {
    if (pw.idleTimer) { clearTimeout(pw.idleTimer); pw.idleTimer = null; }
    const i = this.workers.indexOf(pw);
    if (i >= 0) this.workers.splice(i, 1);
    try { await pw.w.terminate(); } catch { /* already gone */ }
    this.wake();
  }

  private wake(): void {
    const w = this.waiters.shift();
    if (w) w();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const all = [...this.workers];
    await Promise.all(all.map((pw) => this.discard(pw)));
    while (this.waiters.length) this.wake();
  }
}

/* ---------------- result mapping ---------------- */
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0);
const box = (b: BBox): BBox => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });

export function toPageResult(page: PageImage, data: TessPageLike, timings: { totalMs: number; recognizeMs: number }): PageResult {
  const blocks: OcrBlock[] = [];
  let sum = 0;
  let n = 0;
  for (const b of data.blocks ?? []) {
    const lines: OcrLine[] = [];
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        const words: OcrWord[] = (l.words ?? [])
          .filter((w) => w.text.trim().length > 0)
          .map((w) => ({ text: w.text, confidence: clamp01(w.confidence), bbox: box(w.bbox) }));
        for (const w of words) { sum += w.confidence; n++; }
        lines.push({ text: l.text.trimEnd(), confidence: clamp01(l.confidence), bbox: box(l.bbox), words });
      }
    }
    blocks.push({ text: b.text.trimEnd(), confidence: clamp01(b.confidence), bbox: box(b.bbox), lines });
  }
  const text = data.text ?? "";
  return {
    pageNumber: page.pageNumber,
    text,
    blocks,
    meanConfidence: n > 0 ? sum / n : 0,
    orientationDeg: null,
    script: detectScript(text),
    providerId: "tesseract",
    timings,
    source: "ocr",
  };
}
