import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * The DLQ message carries the last handler error (`dlqLastError`, truncated, no personal data), and the
 * `queue_message_dead_lettered` log line carries messageId + correlationId. Fully mocked SQS client,
 * same pattern as perf-004-dlq-backoff.test.ts.
 */
const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
const state = { body: "", delivered: false, receiveCount: 0, failDlq: null as null | "attr" | "all", maxDeliveries: 1000 };

vi.mock("@aws-sdk/client-sqs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sqs")>();
  class FakeSQSClient {
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = cmd.constructor.name;
      sent.push({ name, input: cmd.input });
      switch (name) {
        case "GetQueueUrlCommand": return { QueueUrl: `https://sqs.test/${String(cmd.input.QueueName)}` };
        case "GetQueueAttributesCommand": return { Attributes: { QueueArn: "arn:aws:sqs:ap-south-1:000000000000:fake-dlq" } };
        case "ReceiveMessageCommand": {
          if (state.delivered || state.receiveCount >= state.maxDeliveries) { await new Promise((r) => setTimeout(r, 15)); return { Messages: [] }; }
          state.receiveCount += 1;
          return { Messages: [{ Body: state.body, ReceiptHandle: `rh-${state.receiveCount}`, Attributes: { ApproximateReceiveCount: String(state.receiveCount) } }] };
        }
        case "SendMessageCommand": {
          const attrs = (cmd.input.MessageAttributes ?? {}) as Record<string, unknown>;
          if (String(cmd.input.QueueUrl).endsWith("-dlq") && (state.failDlq === "all" || (state.failDlq === "attr" && "dlqLastError" in attrs))) {
            throw new Error("InvalidParameterValue: invalid attribute");
          }
          return {};
        }
        case "DeleteMessageCommand": state.delivered = true; return {};
        default: return {};
      }
    }
  }
  return { ...actual, SQSClient: FakeSQSClient };
});

const MESSAGE_ID = randomUUID();
const CORRELATION_ID = `corr-${randomUUID().slice(0, 8)}`;

function envelope(topic: string) {
  return JSON.stringify({
    messageId: MESSAGE_ID, type: topic, tenantId: "tenant-1", actorId: "actor-1", correlationId: CORRELATION_ID,
    timestamp: new Date().toISOString(), schemaVersion: "1.0", payload: { hello: "world" },
  });
}

async function runUntilDelivered(topic: string, handler: () => Promise<void>) {
  const { SqsQueue } = await import("../src/bus.js");
  state.body = envelope(topic);
  const queue = new SqsQueue();
  queue.subscribe(topic, handler);
  await queue.start();
  const deadline = Date.now() + 5000;
  while (!state.delivered && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  await queue.stop();
}

const dlqSends = () => sent.filter((c) => c.name === "SendMessageCommand" && String(c.input.QueueUrl).endsWith("-dlq"));
const dlqSend = () => dlqSends().at(-1);
const attrs = () => (dlqSend()!.input.MessageAttributes as Record<string, { StringValue: string }>);

describe("DLQ last-error attribute and log context", () => {
  let logs: string[];
  beforeEach(() => {
    sent.length = 0; state.receiveCount = 0; state.delivered = false; state.failDlq = null; state.maxDeliveries = 1000;
    process.env.SQS_MAX_RECEIVE_COUNT = "2";
    process.env.SQS_BACKOFF_BASE_SECONDS = "1";
    logs = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => { logs.push(String(line)); });
  });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.SQS_MAX_RECEIVE_COUNT; delete process.env.SQS_BACKOFF_BASE_SECONDS; });

  it("max_receive_count_exceeded: dlqLastError holds the handler's error, the log line has messageId + correlationId", async () => {
    const topic = `qtest.dlqerr.${randomUUID().slice(0, 8)}`;
    await runUntilDelivered(topic, async () => { throw new Error('insert or update on table "finance_payments" violates foreign key constraint "fk_x"'); });
    expect(attrs().dlqReason.StringValue).toBe("max_receive_count_exceeded");
    expect(attrs().dlqLastError.StringValue).toContain('violates foreign key constraint "fk_x"');
    const line = JSON.parse(logs.find((l) => l.includes("queue_message_dead_lettered"))!);
    expect(line).toMatchObject({ topic, reason: "max_receive_count_exceeded", messageId: MESSAGE_ID, correlationId: CORRELATION_ID });
  });

  it("non_retryable_error: dlqLastError holds the NonRetryableError message", async () => {
    const { NonRetryableError } = await import("../src/bus.js");
    const topic = `qtest.dlqnr.${randomUUID().slice(0, 8)}`;
    await runUntilDelivered(topic, async () => { throw new NonRetryableError("BANK_ACCOUNT_NOT_FOUND: nope"); });
    expect(attrs().dlqReason.StringValue).toBe("non_retryable_error");
    expect(attrs().dlqLastError.StringValue).toContain("BANK_ACCOUNT_NOT_FOUND: nope");
  });
});

describe("DLQ send failures never lose the source message", () => {
  let logs: string[];
  beforeEach(() => {
    sent.length = 0; state.receiveCount = 0; state.delivered = false; state.failDlq = null; state.maxDeliveries = 1000;
    process.env.SQS_MAX_RECEIVE_COUNT = "2";
    logs = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => { logs.push(String(line)); });
  });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.SQS_MAX_RECEIVE_COUNT; });

  it("a send rejected WITH dlqLastError is retried once without it, and the source message is then deleted", async () => {
    state.failDlq = "attr";
    const { NonRetryableError } = await import("../src/bus.js");
    const topic = `qtest.dlqretry.${randomUUID().slice(0, 8)}`;
    await runUntilDelivered(topic, async () => { throw new NonRetryableError("BANK_ACCOUNT_NOT_FOUND"); });
    const sends = dlqSends();
    expect(sends).toHaveLength(2);
    expect("dlqLastError" in (sends[0]!.input.MessageAttributes as object)).toBe(true);
    expect("dlqLastError" in (sends[1]!.input.MessageAttributes as object)).toBe(false);
    expect((sends[1]!.input.MessageAttributes as Record<string, { StringValue: string }>).dlqReason.StringValue).toBe("non_retryable_error");
    expect(sends[1]!.input.MessageBody).toBe(state.body);
    expect(state.delivered).toBe(true);
    expect(logs.some((l) => l.includes("queue_message_dead_lettered"))).toBe(true);
  });

  it.each([
    ["non_retryable_error", "nr"],
    ["max_receive_count_exceeded", "mr"],
  ])("%s: when the DLQ send fails even without the attribute, the source message is NOT deleted", async (reason, tag) => {
    state.failDlq = "all";
    state.maxDeliveries = 3;
    const { NonRetryableError, SqsQueue } = await import("../src/bus.js");
    const topic = `qtest.dlqfail.${tag}.${randomUUID().slice(0, 8)}`;
    state.body = envelope(topic);
    const queue = new SqsQueue();
    queue.subscribe(topic, async () => { throw reason === "non_retryable_error" ? new NonRetryableError("nope") : new Error("boom"); });
    await queue.start();
    await new Promise((r) => setTimeout(r, 600));
    await queue.stop();
    expect(dlqSends().length).toBeGreaterThanOrEqual(2);
    expect(sent.filter((c) => c.name === "DeleteMessageCommand")).toHaveLength(0);
    expect(state.delivered).toBe(false);
    expect(logs.some((l) => l.includes("queue_message_dead_lettered"))).toBe(false);
  });

  it("an unparseable body that cannot be parked is not deleted either", async () => {
    state.failDlq = "all";
    state.maxDeliveries = 2;
    const { SqsQueue } = await import("../src/bus.js");
    const topic = `qtest.dlqfail.bad.${randomUUID().slice(0, 8)}`;
    state.body = "{not json";
    const queue = new SqsQueue();
    queue.subscribe(topic, async () => undefined);
    await queue.start();
    await new Promise((r) => setTimeout(r, 400));
    await queue.stop();
    expect(sent.filter((c) => c.name === "DeleteMessageCommand")).toHaveLength(0);
  });
});

describe("dlqErrorText", () => {
  it("removes characters SQS rejects (ANSI escapes, lone surrogates) and cuts on a code-point boundary", async () => {
    const { dlqErrorText, DLQ_LAST_ERROR_MAX_CHARS } = await import("../src/bus.js");
    expect(dlqErrorText(new Error("\u001b[31mred\u001b[0m\u0000 ok\ttab"))).toBe("[31mred[0m ok tab");
    expect(dlqErrorText(new Error("a\uD800b\uDC00c"))).toBe("abc");
    // an emoji (surrogate pair) straddling the cut is kept whole or dropped, never split
    const cut = "x".repeat(DLQ_LAST_ERROR_MAX_CHARS - 2) + "😀😀tail";
    const out = dlqErrorText(new Error(cut))!;
    expect(Array.from(out).length).toBeLessThanOrEqual(DLQ_LAST_ERROR_MAX_CHARS);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
    expect(out.endsWith("…")).toBe(true);
    const exact = dlqErrorText(new Error("😀".repeat(DLQ_LAST_ERROR_MAX_CHARS)))!;
    expect(exact).toBe("😀".repeat(DLQ_LAST_ERROR_MAX_CHARS));
  });

  it("masks spaced Aadhaar, spaced phone numbers and lowercase PAN", async () => {
    const { dlqErrorText } = await import("../src/bus.js");
    expect(dlqErrorText(new Error("aadhaar 1234 5678 9012 bad"))).toBe("aadhaar [num] bad");
    expect(dlqErrorText(new Error("call 98765 43210 now"))).toBe("call [num] now");
    expect(dlqErrorText(new Error("call +91-98765-43210 now"))).toBe("call +[num] now");
    expect(dlqErrorText(new Error("pan abcde1234f seen"))).toBe("pan [id] seen");
  });
});

describe("dlqErrorText (basics)", () => {
  it("is undefined without an error, first line only, truncated, and masks e-mails and long digit runs", async () => {
    const { dlqErrorText, DLQ_LAST_ERROR_MAX_CHARS } = await import("../src/bus.js");
    expect(dlqErrorText(undefined)).toBeUndefined();
    expect(dlqErrorText(new Error("   "))).toBeUndefined();
    expect(dlqErrorText(new Error("boom\n    at stack frame"))).toBe("boom");
    const masked = dlqErrorText(new Error("payee a.b@example.org acct 123456789012 pan ABCDE1234F failed"))!;
    expect(masked).toBe("payee [email] acct [num] pan [id] failed");
    const long = dlqErrorText(new Error("x".repeat(1000)))!;
    expect(long.length).toBe(DLQ_LAST_ERROR_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });
});
