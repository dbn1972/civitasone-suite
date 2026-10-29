/**
 * Report render HTML safety (review follow-up on PR #2374, SSRF):
 *  - every user-controlled value interpolated into the render HTML is escaped;
 *  - the HTML handed to headless Chromium carries a CSP that blocks ALL
 *    network/file loads and script, so an injected <img>/<iframe>/<link>/<script>
 *    cannot make the renderer fetch anything (verified against real Chromium
 *    when it is installed on the host).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { renderPdf } from "@civitasone/render/pdf";
import {
  escapeHtml, withRenderSandbox, buildJobReportHtml, buildTemplateReportHtml, RENDER_CSP,
} from "../src/shared/report-html.js";

const EVIL = "<img src=http://127.0.0.1:1/x>";
const NOW = new Date("2026-10-29T00:00:00.000Z");

describe("escapeHtml / report HTML builders", () => {
  it("escapes & < > \" '", () => {
    expect(escapeHtml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;");
  });

  it("a template whose name carries an <img> tag renders the tag as text", () => {
    const html = buildTemplateReportHtml(EVIL, `x"><iframe src=file:///etc/passwd>`, NOW);
    expect(html).toContain("&lt;img src=http://127.0.0.1:1/x&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
  });

  it("a job whose name/report type carry markup renders them as text", () => {
    const html = buildJobReportHtml(EVIL, "<link rel=stylesheet href=http://127.0.0.1:1/s.css>", NOW);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<link");
  });

  it("withRenderSandbox prefixes a no-network, no-script CSP exactly once", () => {
    const once = withRenderSandbox("<html><body>x</body></html>");
    expect(once.startsWith(`<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)).toBe(true);
    expect(RENDER_CSP).toContain("default-src 'none'");
    expect(RENDER_CSP).toContain("script-src 'none'");
    expect(withRenderSandbox(once)).toBe(once);
  });
});

// ── Real headless Chromium: the sandbox must stop outbound requests ────────────
let server: Server;
let hits: string[] = [];
let base = "";
let chromium = false;

beforeAll(async () => {
  server = createServer((req, res) => { hits.push(req.url ?? ""); res.end("ok"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  delete process.env.RENDER_PDF_MODE;
  chromium = (await renderPdf({ html: "<p>probe</p>" })).mode === "playwright";
}, 60_000);
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function hostile(): string {
  return `<html><head><link rel="stylesheet" href="${base}/css"></head><body>
    <img src="${base}/img"><iframe src="${base}/frame"></iframe>
    <script>fetch("${base}/js")</script><object data="${base}/obj"></object>
  </body></html>`;
}

describe("headless renderer network isolation", () => {
  it("control: without the sandbox Chromium does fetch the injected URLs (probe works)", async (ctx) => {
    if (!chromium) ctx.skip();
    hits = [];
    const r = await renderPdf({ html: hostile() });
    expect(r.mode).toBe("playwright");
    expect(hits.length).toBeGreaterThan(0);
  }, 60_000);

  it("with withRenderSandbox every external request is blocked (0 hits) and the PDF still renders", async (ctx) => {
    if (!chromium) ctx.skip();
    hits = [];
    const r = await renderPdf({ html: withRenderSandbox(hostile()) });
    expect(r.mode).toBe("playwright");
    expect(r.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(hits).toEqual([]);
  }, 60_000);
});
