/**
 * Static regression: worker.ts must NOT re-introduce a per-topic DLQ poller
 * loop. Native SQS RedrivePolicy already dead-letters messages that exceed
 * maxReceiveCount inside SQS itself — subscribing to every `${topic}.dlq`
 * (one extra long-poller PER topic) multiplies SQS ReceiveMessage traffic and
 * open connections for no operational gain. DLQ observability belongs on the
 * ops side (CloudWatch/SQS console alarms), not in this worker.
 *
 * This test reads worker.ts as plain text (it is NOT imported) since
 * importing it would execute its top-level side effects (queue.start(),
 * DB connections, etc.) outside of a running infra environment.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workerSource = readFileSync(
  join(__dirname, "../src/worker.ts"),
  "utf8",
);

describe("inspection-service worker — no DLQ poll explosion", () => {
  it("does not subscribe to a `${topic}.dlq` pattern", () => {
    expect(workerSource).not.toMatch(/\$\{[^}]*\}\.dlq/);
  });

  it("does not build a `.dlq` template-literal topic string", () => {
    expect(workerSource).not.toMatch(/`[^`]*\.dlq`/);
  });

  it("has no queue.subscribe(...) call whose topic argument references dlq", () => {
    const subscribeCalls = workerSource.match(/queue\.subscribe\([^)]*\)/gs) ?? [];
    for (const call of subscribeCalls) {
      expect(call.toLowerCase()).not.toContain("dlq");
    }
  });

  it("does not loop over COMMANDS/CONSUMED_EVENTS to register DLQ subscriptions", () => {
    expect(workerSource).not.toContain("allTopics");
    expect(workerSource).not.toMatch(/for\s*\(const topic of[^)]*\)\s*\{[^}]*\.dlq/s);
  });

  it("keeps a comment noting SQS RedrivePolicy already handles dead-lettering", () => {
    expect(workerSource).toMatch(/RedrivePolicy/);
  });
});
