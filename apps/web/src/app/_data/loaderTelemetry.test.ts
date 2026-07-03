import { describe, it, expect, beforeEach } from "vitest";
import { recordLoaderFallback, getLoaderFallbackEvents, type LoaderFallbackEvent } from "./loaderTelemetry";

describe("loaderTelemetry", () => {
  // Note: events are module-global; tests see accumulated state.
  // Each test uses distinct keys so assertions don't collide.

  it("records and retrieves events", () => {
    const event: LoaderFallbackEvent = {
      key: "test-1",
      reason: "http_error",
      statusCode: 500,
      path: "/v1/finance/bills",
      timestamp: "2026-06-27T10:00:00Z",
    };
    recordLoaderFallback(event);
    const events = getLoaderFallbackEvents();
    expect(events.find((e) => e.key === "test-1")).toBeDefined();
    expect(events.find((e) => e.key === "test-1")!.reason).toBe("http_error");
  });

  it("records multiple events", () => {
    recordLoaderFallback({ key: "test-2a", reason: "network_error", path: "/v1/hr/leave", timestamp: "2026-06-27T10:01:00Z" });
    recordLoaderFallback({ key: "test-2b", reason: "no_base_url", path: "/v1/admin/settings", timestamp: "2026-06-27T10:02:00Z" });
    const events = getLoaderFallbackEvents();
    expect(events.filter((e) => e.key.startsWith("test-2"))).toHaveLength(2);
  });

  it("returns a copy (not internal array reference)", () => {
    const events1 = getLoaderFallbackEvents();
    const events2 = getLoaderFallbackEvents();
    expect(events1).not.toBe(events2);
    expect(events1).toEqual(events2);
  });

  it("caps events at 200 (overflow eviction)", () => {
    for (let i = 0; i < 250; i++) {
      recordLoaderFallback({ key: `overflow-${i}`, reason: "invalid_payload", path: "/test", timestamp: `2026-06-27T${i}` });
    }
    const events = getLoaderFallbackEvents();
    expect(events.length).toBeLessThanOrEqual(200);
  });
});
