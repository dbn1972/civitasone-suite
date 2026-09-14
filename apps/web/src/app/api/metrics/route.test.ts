import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { captureError, resetFailureMetrics } from "@civitasone/observability";

// Deliberately does NOT mock @civitasone/observability (unlike
// api/auth/callback/route.test.ts) -- the whole point of this suite is
// verifying that a REAL captureError() call becomes a REAL, correctly
// formatted Prometheus counter line on this route, end to end.

const TOKEN = "test-metrics-token-abc123";
const ORIGINAL_TOKEN = process.env.METRICS_TOKEN;

function metricsRequest(authHeader?: string): Request {
  return new Request("https://civitasone.example.gov.in/api/metrics", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("GET /api/metrics -- SEC-029 Prometheus scrape path", () => {
  beforeEach(() => {
    resetFailureMetrics();
    process.env.METRICS_TOKEN = TOKEN;
  });

  afterEach(() => {
    resetFailureMetrics();
    if (ORIGINAL_TOKEN === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = ORIGINAL_TOKEN;
  });

  it("fails closed (403) when METRICS_TOKEN isn't configured, even with a token supplied -- no internal-IP fallback", async () => {
    delete process.env.METRICS_TOKEN;
    const { GET } = await import("./route");

    const res = await GET(metricsRequest(`Bearer ${TOKEN}`));

    expect(res.status).toBe(403);
  });

  it("rejects a request with no Authorization header", async () => {
    const { GET } = await import("./route");

    const res = await GET(metricsRequest());

    expect(res.status).toBe(403);
  });

  it("rejects a wrong token", async () => {
    const { GET } = await import("./route");

    const res = await GET(metricsRequest("Bearer wrong-token"));

    expect(res.status).toBe(403);
  });

  it("returns valid Prometheus exposition text for a correct token", async () => {
    const { GET } = await import("./route");

    const res = await GET(metricsRequest(`Bearer ${TOKEN}`));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("# HELP service_up Service process is running");
    expect(body).toContain("# TYPE service_up gauge");
    expect(body).toContain('service_up{service="web"} 1');
    // formatSharedMetrics()'s metric families are present even with zero
    // samples recorded yet (HELP/TYPE preamble only) -- same shape a brand
    // new backend service shows on its first scrape.
    expect(body).toContain("# HELP captured_errors_total");
    expect(body).toContain("# TYPE captured_errors_total counter");
    expect(body).not.toContain('captured_errors_total{service="web"}');
  });

  it("SEC-027's captureError() counter appears and increments -- the actual gap SEC-029 closes", async () => {
    const { GET } = await import("./route");

    captureError(new Error("simulated session-creation failure"), {
      service: "web",
      event: "auth_callback_session_create_failed",
    });
    let body = await (await GET(metricsRequest(`Bearer ${TOKEN}`))).text();
    expect(body).toContain('captured_errors_total{service="web"} 1');

    captureError(new Error("second simulated failure"), {
      service: "web",
      event: "auth_callback_session_create_failed",
    });
    body = await (await GET(metricsRequest(`Bearer ${TOKEN}`))).text();
    expect(body).toContain('captured_errors_total{service="web"} 2');
  });
});
