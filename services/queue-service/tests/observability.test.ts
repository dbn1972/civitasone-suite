import { describe, it, expect, beforeEach } from "vitest";
import {
  captureError, setErrorReporter, getCapturedErrorCount, resetCapturedErrors,
  getCapturedErrorCountByService,
  incrementConsumerError, getConsumerErrorCount,
  incrementDlqMessage, getDlqMessageCount,
  incrementOutboxRelayFailure, getOutboxRelayFailureCount,
  resetConsumerErrorMetrics, resetFailureMetrics,
} from "@civitasone/observability";
import { MemoryQueue } from "../src/bus.js";

/**
 * OPS-1 (09-T1): failures must be observable. These assert the capture hook and
 * the failure metrics, plus a queue-level fault injection (throwing handler →
 * dead-letter, not infinite silent retry).
 */
describe("observability — error capture + failure metrics (09-T1)", () => {
  beforeEach(() => {
    resetCapturedErrors();
    resetConsumerErrorMetrics();
    resetFailureMetrics();
    setErrorReporter(() => {}); // reset any prior reporter via a no-op
  });

  it("captureError logs, counts, and forwards to the registered reporter", () => {
    const seen: unknown[] = [];
    setErrorReporter((err) => seen.push(err));
    const boom = new Error("boom");

    captureError(boom, { service: "finance", topic: "finance.gl.post" });

    expect(getCapturedErrorCount()).toBe(1);
    expect(seen).toContain(boom);
  });

  it("a thrown reporter never breaks captureError", () => {
    setErrorReporter(() => { throw new Error("reporter down"); });
    expect(() => captureError(new Error("x"), {})).not.toThrow();
    expect(getCapturedErrorCount()).toBe(1);
  });

  it("failure metrics increment by label", () => {
    incrementConsumerError("finance", "finance.gl.post");
    incrementConsumerError("finance", "finance.gl.post");
    incrementDlqMessage("finance.gl.post");
    incrementOutboxRelayFailure("finance");

    expect(getConsumerErrorCount("finance", "finance.gl.post")).toBe(2);
    expect(getDlqMessageCount("finance.gl.post")).toBe(1);
    expect(getOutboxRelayFailureCount("finance")).toBe(1);
  });

  it("captureError increments the service-labeled captured_errors_total metric (T1.2)", () => {
    captureError(new Error("boom"), { service: "finance", topic: "finance.gl.post" });
    captureError(new Error("boom2"), { service: "finance" });
    captureError(new Error("other"), { service: "grant" });
    // missing service falls into the "unknown" series, never dropped
    captureError(new Error("nosvc"), {});

    expect(getCapturedErrorCountByService("finance")).toBe(2);
    expect(getCapturedErrorCountByService("grant")).toBe(1);
    expect(getCapturedErrorCountByService("unknown")).toBe(1);
    // global counter still tracks the total across services
    expect(getCapturedErrorCount()).toBe(4);
  });

  it("resetFailureMetrics clears the captured_errors_total series", () => {
    captureError(new Error("boom"), { service: "finance" });
    expect(getCapturedErrorCountByService("finance")).toBe(1);
    resetFailureMetrics();
    expect(getCapturedErrorCountByService("finance")).toBe(0);
  });

  it("fault injection: a throwing handler dead-letters after max attempts", async () => {
    const q = new MemoryQueue({ maxAttempts: 3 });
    let calls = 0;
    q.subscribe("test.topic", async () => { calls++; throw new Error("handler boom"); });

    await q.publish("test.topic", {
      type: "test.topic", tenantId: "t", actorId: "a", correlationId: "c", schemaVersion: "1.0", payload: {},
    });
    // allow the in-process retry/backoff loop to exhaust attempts
    await new Promise((r) => setTimeout(r, 200));

    expect(calls).toBe(3);
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.topic).toBe("test.topic");
  });
});
