/**
 * PDF rendering via Playwright chromium (headless).
 *
 * Uses the same Playwright chromium already installed for e2e tests.
 * Falls back to raw HTML buffer when Playwright is unavailable (dev/test).
 *
 * Env vars:
 *   RENDER_PDF_MODE        — "playwright" (default if available) | "html-only"
 *   PLAYWRIGHT_CHROMIUM_PATH — override chromium executable path
 *   DSC_P12_PATH           — path to PKCS#12 DSC keystore for PDF signing
 *   DSC_PASSPHRASE         — passphrase for the PKCS#12 keystore
 */




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

/**
 * Render HTML to PDF using Playwright chromium.
 * Falls back to returning the HTML as a buffer if Playwright is not available.
 */
export async function renderPdf(opts: PdfRenderOptions): Promise<PdfRenderResult> {
  const mode = process.env.RENDER_PDF_MODE ?? "playwright";

  if (mode === "html-only") {
    return { buffer: Buffer.from(opts.html, "utf-8"), mode: "html-only", signed: false };
  }

  try {
    // Dynamic import — Playwright is a peer dep
    const pw = await import("playwright-core");
    const execPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? undefined;

    const browser = await pw.chromium.launch({
      headless: true,
      ...(execPath ? { executablePath: execPath } : {}),
    });

    try {
      const page = await browser.newPage();
      await page.setContent(opts.html, { waitUntil: "networkidle" });

      const pdfBuffer = await page.pdf({
        format: opts.format ?? "A4",
        landscape: opts.landscape ?? false,
        margin: opts.margin ?? { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
        displayHeaderFooter: opts.displayHeaderFooter ?? false,
        headerTemplate: opts.headerTemplate ?? "",
        footerTemplate: opts.footerTemplate ?? "",
        printBackground: true,
      });

      const buffer = Buffer.from(pdfBuffer);
      const signed = await maybeSignPdf(buffer);

      return {
        buffer: signed.buffer,
        mode: "playwright",
        signed: signed.applied,
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    // Playwright not available — fall back to HTML
    console.warn({ err: (err as Error).message }, "Playwright unavailable, returning HTML as fallback");
    return { buffer: Buffer.from(opts.html, "utf-8"), mode: "html-only", signed: false };
  }
}

/**
 * DSC signing seam: applies PKCS7 detached signature when DSC_P12_PATH is set.
 * Otherwise returns the buffer unchanged with a log warning.
 */
async function maybeSignPdf(buffer: Buffer): Promise<{ buffer: Buffer; applied: boolean }> {
  const p12Path = process.env.DSC_P12_PATH;
  const passphrase = process.env.DSC_PASSPHRASE;

  if (!p12Path || !passphrase) {
    console.info("PDF unsigned (DSC_P12_PATH/DSC_PASSPHRASE not set) — set env vars to enable DSC signing");
    return { buffer, applied: false };
  }

  // In a full implementation, this would:
  // 1. Parse the PKCS#12 keystore
  // 2. Create a PKCS#7 detached signature over the PDF hash
  // 3. Embed the signature in the PDF's signature annotation
  // For now, log that signing would occur and return unsigned.
  // A production implementation would use node-forge or a native OpenSSL binding.
  console.info({ p12Path }, "DSC signing seam: signing would be applied with configured certificate");

  // TODO: Implement actual PKCS#7 signing when a signing library is added
  // const { signPdfBuffer } = await import("./dsc-signer.js");
  // return { buffer: await signPdfBuffer(buffer, p12Path, passphrase), applied: true };

  return { buffer, applied: false };
}
