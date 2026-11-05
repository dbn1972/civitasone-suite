/**
 * Shared Chromium renderPdf hardening (PR #2463 delta review, non-blocking hardening): a per-render timeout
 * frees the slot, and the render context runs with JavaScript disabled and every non-inline (non data:/blob:/about:)
 * request aborted, so a missed escape in a template can neither run script nor reach a network host.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closePdfRenderer, renderPdf } from "./pdf.js";

let server: Server;
let hits = 0;
let port = 0;
beforeAll(async () => {
  server = createServer((_req, res) => { hits++; res.statusCode = 200; res.end("x"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterEach(() => { delete process.env.RENDER_PDF_TIMEOUT_MS; });
afterAll(async () => { await closePdfRenderer(); await new Promise<void>((r) => server.close(() => r())); });

/** PDF Info /Title as written by Chromium: PDF text string, UTF-16BE (BOM FE FF) or plain. */
function hasTitle(buf: Buffer, title: string): boolean {
  const utf16 = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(title, "utf16le").swap16()]);
  return buf.includes(utf16) || buf.includes(Buffer.from(`(${title})`, "latin1"));
}

describe("renderPdf hardening", () => {
  it("renders an inline document normally", async () => {
    const r = await renderPdf({ html: "<html><head><title>STATIC-TITLE</title></head><body><p>hello</p></body></html>" });
    expect(r.mode).toBe("playwright");
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("does not run page script", async () => {
    const r = await renderPdf({ html: "<html><head><title>STATIC-TITLE</title></head><body><script>document.title='SCRIPT-RAN'</script></body></html>" });
    expect(r.mode).toBe("playwright");
    expect(hasTitle(r.buffer, "STATIC-TITLE")).toBe(true);
    expect(hasTitle(r.buffer, "SCRIPT-RAN")).toBe(false);
  });

  it("does not fetch http resources (image, stylesheet) during a render", async () => {
    hits = 0;
    const r = await renderPdf({ html: `<html><head><link rel="stylesheet" href="http://127.0.0.1:${port}/a.css"></head><body><img src="http://127.0.0.1:${port}/b.png"><p>x</p></body></html>` });
    expect(r.mode).toBe("playwright");
    expect(hits).toBe(0);
  });

  it("a render that exceeds RENDER_PDF_TIMEOUT_MS is torn down and the slot is freed for the next render", async () => {
    process.env.RENDER_PDF_TIMEOUT_MS = "1";
    const timedOut = await renderPdf({ html: "<html><body><p>slow</p></body></html>" });
    expect(timedOut.mode).toBe("html-only"); // renderPdf's existing fallback after a render error
    delete process.env.RENDER_PDF_TIMEOUT_MS;
    const ok = await renderPdf({ html: "<html><body><p>after</p></body></html>" });
    expect(ok.mode).toBe("playwright");
  });
});
