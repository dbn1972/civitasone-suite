/**
 * Analytics domain logic — HTML instrumentation and metrics aggregation.
 */

/**
 * Instruments HTML for open/click tracking.
 * - Adds a 1x1 tracking pixel before </body>
 * - Wraps all <a href="..."> links through a click-tracking redirect
 * If optedOut is true, returns the original html unmodified.
 */
export function instrumentHtml(
  html: string, deliveryId: string, baseUrl: string, optedOut: boolean,
): string {
  if (optedOut) return html;

  // Add tracking pixel before </body>
  const pixelUrl = `${baseUrl}/t/pixel/${deliveryId}.png`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;
  let instrumented = html.replace(/<\/body>/i, `${pixel}</body>`);

  // If no </body> tag, append pixel at the end
  if (!instrumented.includes(pixel)) {
    instrumented = instrumented + pixel;
  }

  // Wrap links through click tracking redirect
  instrumented = instrumented.replace(
    /<a\s([^>]*?)href="([^"]+)"([^>]*?)>/gi,
    (_match, before, href, after) => {
      const trackUrl = `${baseUrl}/t/click/${deliveryId}?url=${encodeURIComponent(href)}`;
      return `<a ${before}href="${trackUrl}"${after}>`;
    },
  );

  return instrumented;
}

export type MetricsEvent = {
  type: "open" | "click" | "sent";
  deliveryId: string;
  timestamp: Date;
};

export type MetricsAggregate = {
  sentCount: number;
  openCount: number;
  clickCount: number;
  openRate: number;
  clickRate: number;
};

/** Build aggregate metrics from a list of events. */
export function buildMetricsAggregate(events: MetricsEvent[]): MetricsAggregate {
  let sentCount = 0;
  let openCount = 0;
  let clickCount = 0;

  for (const event of events) {
    switch (event.type) {
      case "sent": sentCount++; break;
      case "open": openCount++; break;
      case "click": clickCount++; break;
    }
  }

  const openRate = sentCount > 0 ? openCount / sentCount : 0;
  const clickRate = sentCount > 0 ? clickCount / sentCount : 0;

  return { sentCount, openCount, clickCount, openRate, clickRate };
}
