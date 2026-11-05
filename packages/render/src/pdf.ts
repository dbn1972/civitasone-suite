/**
 * PDF rendering via Playwright chromium (headless).
 *
 * Uses the same Playwright chromium already installed for e2e tests.
 * Falls back to raw HTML buffer when Playwright is unavailable (dev/test).
 *
 * Env vars:
 *   RENDER_PDF_MODE        — "playwright" (default if available) | "html-only"
 *   RENDER_PDF_TIMEOUT_MS  — per-render timeout (default 30000); a hung render is torn down, its slot freed
 *   PLAYWRIGHT_CHROMIUM_PATH — override chromium executable path
 *   DSC_P12_PATH           — path to PKCS#12 DSC keystore for PDF signing
 *   DSC_PASSPHRASE         — passphrase for the PKCS#12 keystore
 */

import { readFile } from "node:fs/promises";
import { signPdfWithDsc, type DscSignInput } from "./dsc-signer.js";




export interface PdfRenderOptions {
  /** HTML content to render */
  html: string;
  /** Page format (default: A4) */
  format?: "A4" | "Letter" | "Legal" | undefined;
  /** Landscape orientation */
  landscape?: boolean | undefined;
  /** Custom margins (CSS) */
  margin?: { top?: string; right?: string; bottom?: string; left?: string } | undefined;
  /** Header HTML template */
  headerTemplate?: string | undefined;
  /** Footer HTML template */
  footerTemplate?: string | undefined;
  /** Display header and footer */
  displayHeaderFooter?: boolean | undefined;
  /** Use the CSS @page size instead of `format` (official documents set A4 in CSS). */
  preferCSSPageSize?: boolean | undefined;
}

export interface PdfRenderResult {
  /** PDF buffer */
  buffer: Buffer;
  /** Number of pages (if available) */
  pages?: number | undefined;
  /** Render mode used */
  mode: "playwright" | "html-only";
  /** Whether DSC signature was applied */
  signed: boolean;
}

// ── Shared Chromium (one browser per process, reused) ───────────────────────
//
// UAT ux-docs review: every official document (Form 16, payslip, sanction order,
// PO, invoice, GRN, voucher, minutes, service book, 12BA, note sheet) is HTML
// printed to PDF by Chromium, so Devanagari is shaped by HarfBuzz (GSUB + GPOS:
// matras, halant, nukta, anusvara in place) and the text layer is in logical
// order. Launching Chromium per document cost ~1 s; the browser is now launched
// once and reused, each render gets its own context, concurrency is bounded and
// an idle browser is closed.

interface PwPage {
  setContent(html: string, o: { waitUntil: "load" | "networkidle" }): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  pdf(o: Record<string, unknown>): Promise<Uint8Array | Buffer>;
}
interface PwRoute { request(): { url(): string }; abort(): Promise<void>; continue(): Promise<void> }
interface PwContext {
  newPage(): Promise<PwPage>; close(): Promise<void>;
  route(url: string, handler: (route: PwRoute) => void | Promise<void>): Promise<void>;
}
interface PwBrowser { newContext(o?: Record<string, unknown>): Promise<PwContext>; close(): Promise<void>; on(ev: "disconnected", cb: () => void): void; isConnected(): boolean }

let browserPromise: Promise<PwBrowser> | null = null;
let active = 0;
const waiting: Array<() => void> = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function maxConcurrency(): number {
  const n = Number(process.env.RENDER_PDF_CONCURRENCY ?? 4);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

async function sharedBrowser(): Promise<PwBrowser> {
  if (!browserPromise) {
    const p = (async () => {
      const pw = (await import("playwright-core")) as unknown as { chromium: { launch(o: Record<string, unknown>): Promise<PwBrowser> } };
      const execPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? undefined;
      const b = await pw.chromium.launch({ headless: true, ...(execPath ? { executablePath: execPath } : {}) });
      b.on("disconnected", () => { if (browserPromise === p) browserPromise = null; });
      return b;
    })();
    browserPromise = p;
    p.catch(() => { if (browserPromise === p) browserPromise = null; });
  }
  return browserPromise;
}

async function acquireSlot(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (active >= maxConcurrency()) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function releaseSlot(): void {
  active--;
  const next = waiting.shift();
  if (next) { next(); return; }
  if (active === 0) {
    idleTimer = setTimeout(() => { void closePdfRenderer(); }, Number(process.env.RENDER_PDF_IDLE_MS ?? 30_000));
    (idleTimer as { unref?: () => void }).unref?.();
  }
}

/** Close the shared browser (idle timeout, shutdown, test teardown). */
export async function closePdfRenderer(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try { await (await p).close(); } catch { /* already gone */ }
}

function renderTimeoutMs(): number {
  const n = Number(process.env.RENDER_PDF_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Only inline content is allowed to load: data:, blob: and about: URLs. Everything else (http, https, file, ...) is aborted. */
const INLINE_URL = /^(data|blob|about):/i;

async function chromiumPdf(opts: PdfRenderOptions): Promise<Buffer> {
  await acquireSlot();
  let ctx: PwContext | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const browser = await sharedBrowser();
    // Official documents are static HTML with inline fonts and images: no script, no network (a missed escape in
    // a template can then neither run code nor reach internal hosts or local files).
    ctx = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: false });
    await ctx.route("**/*", (route) => (INLINE_URL.test(route.request().url()) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`PDF render timed out after ${renderTimeoutMs()} ms`)), renderTimeoutMs());
    });
    // The race rejects on timeout; the finally below closes the context, which aborts the hung page.
    return await Promise.race([renderPage(page, opts), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (ctx) await ctx.close().catch(() => undefined);
    releaseSlot();
  }
}

async function renderPage(page: PwPage, opts: PdfRenderOptions): Promise<Buffer> {
  await page.setContent(opts.html, { waitUntil: "load" });
  // Inline @font-face (data: URIs) must be decoded before printing.
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(() => true));
  const pdf = await page.pdf({
    format: opts.format ?? "A4",
    landscape: opts.landscape ?? false,
    margin: opts.margin ?? { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
    displayHeaderFooter: opts.displayHeaderFooter ?? false,
    headerTemplate: opts.headerTemplate ?? "",
    footerTemplate: opts.footerTemplate ?? "",
    printBackground: true,
    preferCSSPageSize: opts.preferCSSPageSize ?? false,
  });
  return Buffer.from(pdf);
}

/**
 * Render HTML to PDF using the shared Playwright Chromium.
 * Falls back to returning the HTML as a buffer if Playwright is not available.
 */
export async function renderPdf(opts: PdfRenderOptions): Promise<PdfRenderResult> {
  const mode = process.env.RENDER_PDF_MODE ?? "playwright";

  if (mode === "html-only") {
    return { buffer: Buffer.from(opts.html, "utf-8"), mode: "html-only", signed: false };
  }

  try {
    const buffer = await chromiumPdf(opts);
    const signed = await maybeSignPdf(buffer);
    return { buffer: signed.buffer, mode: "playwright", signed: signed.applied };
  } catch (err) {
    // Playwright not available — fall back to HTML
    console.warn({ err: (err as Error).message }, "Playwright unavailable, returning HTML as fallback");
    return { buffer: Buffer.from(opts.html, "utf-8"), mode: "html-only", signed: false };
  }
}

/**
 * DSC signing seam: applies PKCS7 detached signature when DSC_P12_PATH is set.
 * Otherwise returns the buffer unchanged with a log warning.
 *
 * Optionally accepts explicit DSC material (p12Buffer + passphrase) to bypass env vars.
 */
export async function maybeSignPdf(
  buffer: Buffer,
  dscMaterial?: DscSignInput | undefined,
): Promise<{ buffer: Buffer; applied: boolean }> {
  // Use explicit material if provided, otherwise load from env vars
  let dsc: DscSignInput | undefined = dscMaterial;

  if (!dsc) {
    const p12Path = process.env.DSC_P12_PATH;
    const passphrase = process.env.DSC_PASSPHRASE;

    if (!p12Path || !passphrase) {
      console.info("PDF unsigned (DSC_P12_PATH/DSC_PASSPHRASE not set) — set env vars to enable DSC signing");
      return { buffer, applied: false };
    }

    try {
      const p12Buffer = await readFile(p12Path);
      dsc = { p12Buffer, passphrase };
    } catch (err) {
      console.error({ err: (err as Error).message, p12Path }, "Failed to read DSC P12 file — returning unsigned PDF");
      return { buffer, applied: false };
    }
  }

  try {
    const result = await signPdfWithDsc(buffer, dsc);
    return { buffer: result.buffer, applied: true };
  } catch (err) {
    console.error({ err: (err as Error).message }, "DSC signing failed — returning unsigned PDF");
    return { buffer, applied: false };
  }
}
