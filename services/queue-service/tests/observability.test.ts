import { describe, it, expect, beforeEach } from "vitest";
import {
  captureError, setErrorReporter, getCapturedErrorCount, resetCapturedErrors,
  getCapturedErrorCountByService,
  incrementConsumerError, getConsumerErrorCount,
  incrementDlqMessage, getDlqMessageCount,
  incrementOutboxRelayFailure, getOutboxRelayFailureCount,
  incrementPublishNoSubscribers, getPublishNoSubscribersCount,
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
    incrementPublishNoSubscribers("finance.gl.post");

    expect(getConsumerErrorCount("finance", "finance.gl.post")).toBe(2);
    expect(getDlqMessageCount("finance.gl.post")).toBe(1);
    expect(getOutboxRelayFailureCount("finance")).toBe(1);
    expect(getPublishNoSubscribersCount("finance.gl.post")).toBe(1);
  });

  it("resetFailureMetrics clears publish_no_subscribers_total too", () => {
    incrementPublishNoSubscribers("finance.gl.post");
    expect(getPublishNoSubscribersCount("finance.gl.post")).toBe(1);
    resetFailureMetrics();
    expect(getPublishNoSubscribersCount("finance.gl.post")).toBe(0);
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
    // deterministic: await drain() (which tracks retry backoffs via inflight)
    // instead of racing a fixed sleep against the real exponential backoff --
    // REL-028: the fixed 200ms sleep flaked under host contention because a
    // setTimeout(...,0)/backoff delay can be pushed past 200ms of real elapsed
    // time under event-loop pressure, even though the nominal backoff total
    // (20ms + 40ms for 3 attempts) is far below it.
    await q.drain();

    expect(calls).toBe(3);
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.topic).toBe("test.topic");
  });

  // PUBLISH-VOID: root cause of a procurement-service incident where a PO
  // creation command published while nobody had subscribed to its topic was
  // silently delivered to nobody — publish() still resolved normally (no
  // throw, no queue_consumer_error, no DLQ entry), so the only trace was the
  // missing downstream write. MemoryQueue is what every non-LocalStack-gated
  // test in this repo actually exercises, so this is the regression surface
  // that matters most for catching this again; the SQS driver's counterpart
  // is covered by queue-service/tests/sqs.localstack.test.ts.
  it("PUBLISH-VOID: publishing to a topic with zero subscribers is now observable, not silent", async () => {
    const q = new MemoryQueue();

    const messageId = await q.publish("nobody.listening", {
      type: "nobody.listening", tenantId: "t", actorId: "a", correlationId: "c", schemaVersion: "1.0", payload: {},
    });

    // The bug: publish() still "succeeds" — same contract as always, so this
    // fix never turns a previously-working call into a thrown error.
    expect(typeof messageId).toBe("string");
    // The fix: the zero-destination case is no longer invisible.
    expect(getPublishNoSubscribersCount("nobody.listening")).toBe(1);
  });

  it("PUBLISH-VOID: once a subscriber exists, the same topic publishes normally with no false-positive metric", async () => {
    const q = new MemoryQueue();
    const received: unknown[] = [];
    q.subscribe("somebody.listening", async (msg) => { received.push(msg); });

    await q.publish("somebody.listening", {
      type: "somebody.listening", tenantId: "t", actorId: "a", correlationId: "c", schemaVersion: "1.0", payload: {},
    });
    await q.drain();

    expect(received).toHaveLength(1);
    expect(getPublishNoSubscribersCount("somebody.listening")).toBe(0);
  });
});
