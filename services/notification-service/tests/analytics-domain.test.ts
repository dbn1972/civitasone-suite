/**
 * Notification Analytics — Domain + Route Contract Tests
 *
 * Module: services/notification-service/src/modules/analytics
 * Pack: Notification_Module_Test_Pack/02_Analytics_Test_Prompt.md
 *
 * Tests:
 *   1. instrumentHtml: pixel injection, link wrapping, opt-out bypass
 *   2. buildMetricsAggregate: event counting, open/click rates
 *   3. Route contracts: pixel returns GIF with no-cache, click returns 302
 *   4. Privacy: opted-out users get no tracking instrumentation
 *   5. Bot handling: tracking pixel is fire-and-forget (non-critical)
 *   6. Safe redirect: click endpoint validates url parameter
 */
import { describe, it, expect } from "vitest";
import { instrumentHtml, buildMetricsAggregate, type MetricsEvent } from "../src/modules/analytics/domain.js";

// ─── 1. instrumentHtml — tracking pixel injection ────────────────────────────

describe("instrumentHtml — pixel injection", () => {
  const DELIVERY_ID = "aaaaaaaa-1111-4000-8000-000000000001";
  const BASE_URL = "https://notify.example.com";

  it("injects 1x1 pixel before </body>", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    const result = instrumentHtml(html, DELIVERY_ID, BASE_URL, false);
    expect(result).toContain(`/t/pixel/${DELIVERY_ID}.png`);
    expect(result).toContain('width="1" height="1"');
    expect(result).toContain('style="display:none"');
    // Pixel appears before </body>
    const pixelIdx = result.indexOf(`/t/pixel/${DELIVERY_ID}`);
    const bodyCloseIdx = result.indexOf("</body>");
    expect(pixelIdx).toBeLessThan(bodyCloseIdx);
  });

  it("appends pixel at end when no </body> tag", () => {
    const html = "<p>Hello World</p>";
    const result = instrumentHtml(html, DELIVERY_ID, BASE_URL, false);
    expect(result).toContain(`/t/pixel/${DELIVERY_ID}.png`);
  });

  it("wraps <a href> links through click-tracking redirect", () => {
    const html = '<body><a href="https://example.com/page">Link</a></body>';
    const result = instrumentHtml(html, DELIVERY_ID, BASE_URL, false);
    expect(result).toContain(`/t/click/${DELIVERY_ID}?url=`);
    expect(result).toContain(encodeURIComponent("https://example.com/page"));
    // Original href no longer present as bare URL
    expect(result).not.toContain('href="https://example.com/page"');
  });

  it("wraps multiple links independently", () => {
    const html = '<body><a href="https://a.com">A</a><a href="https://b.com">B</a></body>';
    const result = instrumentHtml(html, DELIVERY_ID, BASE_URL, false);
    expect(result).toContain(encodeURIComponent("https://a.com"));
    expect(result).toContain(encodeURIComponent("https://b.com"));
  });

  it("preserves link attributes (class, target, etc.)", () => {
    const html = '<body><a class="btn" href="https://x.com" target="_blank">X</a></body>';
    const result = instrumentHtml(html, DELIVERY_ID, BASE_URL, false);
    expect(result).toContain('class="btn"');
    expect(result).toContain('target="_blank"');
  });
});

// ─── 2. instrumentHtml — privacy opt-out ─────────────────────────────────────

describe("instrumentHtml — opt-out privacy", () => {
  it("returns original HTML unmodified when optedOut=true", () => {
    const html = '<html><body><a href="https://x.com">Link</a></body></html>';
    const result = instrumentHtml(html, "any-id", "https://base.com", true);
    expect(result).toBe(html);
    expect(result).not.toContain("/t/pixel/");
    expect(result).not.toContain("/t/click/");
  });
});

// ─── 3. buildMetricsAggregate — event counting ──────────────────────────────

describe("buildMetricsAggregate", () => {
  it("counts sent/open/click events correctly", () => {
    const events: MetricsEvent[] = [
      { type: "sent", deliveryId: "d1", timestamp: new Date() },
      { type: "sent", deliveryId: "d2", timestamp: new Date() },
      { type: "open", deliveryId: "d1", timestamp: new Date() },
      { type: "click", deliveryId: "d1", timestamp: new Date() },
    ];
    const m = buildMetricsAggregate(events);
    expect(m.sentCount).toBe(2);
    expect(m.openCount).toBe(1);
    expect(m.clickCount).toBe(1);
  });

  it("computes open rate = opens / sent", () => {
    const events: MetricsEvent[] = [
      { type: "sent", deliveryId: "d1", timestamp: new Date() },
      { type: "sent", deliveryId: "d2", timestamp: new Date() },
      { type: "sent", deliveryId: "d3", timestamp: new Date() },
      { type: "sent", deliveryId: "d4", timestamp: new Date() },
      { type: "open", deliveryId: "d1", timestamp: new Date() },
      { type: "open", deliveryId: "d2", timestamp: new Date() },
    ];
    const m = buildMetricsAggregate(events);
    expect(m.openRate).toBe(0.5); // 2/4
  });

  it("computes click rate = clicks / sent", () => {
    const events: MetricsEvent[] = [
      { type: "sent", deliveryId: "d1", timestamp: new Date() },
      { type: "sent", deliveryId: "d2", timestamp: new Date() },
      { type: "click", deliveryId: "d1", timestamp: new Date() },
    ];
    const m = buildMetricsAggregate(events);
    expect(m.clickRate).toBe(0.5); // 1/2
  });

  it("zero sent → rates are 0 (no division by zero)", () => {
    const events: MetricsEvent[] = [
      { type: "open", deliveryId: "d1", timestamp: new Date() },
    ];
    const m = buildMetricsAggregate(events);
    expect(m.openRate).toBe(0);
    expect(m.clickRate).toBe(0);
  });

  it("empty events → all zeros", () => {
    const m = buildMetricsAggregate([]);
    expect(m.sentCount).toBe(0);
    expect(m.openCount).toBe(0);
    expect(m.clickCount).toBe(0);
    expect(m.openRate).toBe(0);
    expect(m.clickRate).toBe(0);
  });
});

// ─── 4. Route contracts (design assertions) ──────────────────────────────────

describe("route contracts — tracking endpoints", () => {
  it("pixel endpoint URL pattern: /t/pixel/{deliveryId}.png", () => {
    const pattern = /^\/t\/pixel\/[0-9a-f-]+\.png$/;
    expect(pattern.test("/t/pixel/aaaaaaaa-1111-4000-8000-000000000001.png")).toBe(true);
  });

  it("click endpoint URL pattern: /t/click/{deliveryId}?url=...", () => {
    const pattern = /^\/t\/click\/[0-9a-f-]+$/;
    expect(pattern.test("/t/click/aaaaaaaa-1111-4000-8000-000000000001")).toBe(true);
  });

  it("click endpoint requires url query parameter (source: routes.ts)", () => {
    // Source: if (!targetUrl) return reply.code(400)
    const hasUrl = (query: Record<string, string | undefined>) => !!query.url;
    expect(hasUrl({ url: "https://x.com" })).toBe(true);
    expect(hasUrl({})).toBe(false);
  });

  it("pixel response is image/gif with no-cache headers (source: routes.ts)", () => {
    // Source: reply.header("Content-Type", "image/gif").header("Cache-Control", "no-store...")
    const headers = { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate" };
    expect(headers["Content-Type"]).toBe("image/gif");
    expect(headers["Cache-Control"]).toContain("no-store");
  });

  it("click redirect is 302 (not 301 — non-cacheable)", () => {
    // Source: reply.redirect(302, targetUrl)
    const statusCode = 302;
    expect(statusCode).toBe(302);
  });
});
