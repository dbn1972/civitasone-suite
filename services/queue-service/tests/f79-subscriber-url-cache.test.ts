/**
 * F79: publish() latency must not depend on subscriber-queue discovery after
 * a topic's first resolution.
 *
 * UAT LocalStack answers every SQS call in 3.5-5 s. publish() resolves a
 * topic's subscriber queues with ListQueues behind a 15 s cache that expired
 * hard, so every 15 s per topic per process a publish paid one ListQueues
 * inline (an hrms id-card issue with two publishes took 15-18 s against a
 * 15 s gateway timeout), and a cold burst paid it once per caller.
 *
 * These tests drive SqsQueue against a stubbed SQS client and pin:
 *   - concurrent cold publishes share ONE ListQueues (single-flight);
 *   - an expired entry is served immediately while one background refresh
 *     runs, and a newly created subscriber queue is picked up after it;
 *   - every ListQueues page is followed (NextToken), DLQs excluded;
 *   - a subscriber queue deleted since discovery does not fail the publish.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { SqsQueue } from "../src/bus.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

const BASE = "http://sqs.local/000000000000";
const TOPIC = "hrms.id_card.issue";
const PREFIX = "hrms-id_card-issue__";
const url = (name: string) => `${BASE}/${name}`;

function input() {
  return {
    type: TOPIC,
    tenantId: "t1",
    actorId: "u1",
    correlationId: "c1",
    schemaVersion: "1",
    payload: {},
  };
}

/**
 * Stub client: ListQueues answers after `listDelayMs` from `pages` (one entry
 * per page, chained by NextToken); SendMessage records the target URL and may
 * throw for URLs in `gone`.
 */
function makeQueue(opts: { listDelayMs: number; pages: string[][]; gone?: Set<string> }) {
  const queue = new SqsQueue();
  const calls = { list: 0, listInputs: [] as Record<string, unknown>[], sent: [] as string[] };
  const state = { pages: opts.pages };
  const send = vi.fn(async (cmd: Cmd) => {
    const name = cmd.constructor.name;
    if (name === "ListQueuesCommand") {
      calls.list++;
      calls.listInputs.push(cmd.input);
      await sleep(opts.listDelayMs);
      const page = cmd.input.NextToken ? Number(cmd.input.NextToken) : 0;
      const next = page + 1 < state.pages.length ? String(page + 1) : undefined;
      return { QueueUrls: state.pages[page] ?? [], ...(next ? { NextToken: next } : {}) };
    }
    if (name === "SendMessageCommand") {
      const target = cmd.input.QueueUrl as string;
      if (opts.gone?.has(target)) {
        const err = new Error("The specified queue does not exist.");
        err.name = "QueueDoesNotExist";
        throw err;
      }
      calls.sent.push(target);
      return { MessageId: "m" };
    }
    throw new Error(`unexpected command ${name}`);
  });
  (queue as unknown as { client: { send: typeof send } }).client = { send };
  return { queue, calls, state };
}

describe("F79: SqsQueue subscriber-queue resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("single-flights concurrent cold publishes onto one ListQueues", async () => {
    const a = url(`${PREFIX}hrms-service`);
    const b = url(`${PREFIX}notification-service`);
    const { queue, calls } = makeQueue({ listDelayMs: 100, pages: [[a, b, `${a}-dlq`]] });

    await Promise.all(Array.from({ length: 20 }, () => queue.publish(TOPIC, input())));

    expect(calls.list).toBe(1);
    expect(calls.listInputs[0]?.QueueNamePrefix).toBe(PREFIX);
    expect(calls.sent.filter((u) => u === a)).toHaveLength(20);
    expect(calls.sent.filter((u) => u === b)).toHaveLength(20);
    expect(calls.sent.some((u) => u.endsWith("-dlq"))).toBe(false);
  });

  it("serves an expired entry without waiting and discovers a new queue via one background refresh", async () => {
    const a = url(`${PREFIX}hrms-service`);
    const b = url(`${PREFIX}notification-service`);
    const { queue, calls, state } = makeQueue({ listDelayMs: 300, pages: [[a]] });

    await queue.publish(TOPIC, input()); // cold: populates the cache
    expect(calls.list).toBe(1);

    // A new subscriber queue appears, and the cache entry expires.
    state.pages = [[a, b]];
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 60_000);

    const t0 = performance.now();
    await Promise.all(Array.from({ length: 10 }, () => queue.publish(TOPIC, input())));
    const elapsed = performance.now() - t0;

    // Expiry must not put a ListQueues (300 ms here, seconds on UAT) in the request path.
    expect(elapsed).toBeLessThan(150);
    // ...and the 10 concurrent stale hits trigger exactly one refresh.
    expect(calls.list).toBe(2);

    await sleep(400); // let the background refresh land
    calls.sent.length = 0;
    await queue.publish(TOPIC, input());
    expect(calls.sent.sort()).toEqual([a, b].sort());
    expect(calls.list).toBe(2);
  });

  it("follows every ListQueues page", async () => {
    const a = url(`${PREFIX}hrms-service`);
    const b = url(`${PREFIX}notification-service`);
    const c = url(`${PREFIX}audit-service`);
    const { queue, calls } = makeQueue({ listDelayMs: 1, pages: [[a, `${a}-dlq`], [b], [c]] });

    await queue.publish(TOPIC, input());

    expect(calls.list).toBe(3);
    expect(calls.listInputs.map((i) => i.NextToken)).toEqual([undefined, "1", "2"]);
    expect(calls.sent.sort()).toEqual([a, b, c].sort());
  });

  it("a subscriber queue deleted after discovery does not fail the publish", async () => {
    const a = url(`${PREFIX}hrms-service`);
    const b = url(`${PREFIX}notification-service`);
    const gone = new Set<string>();
    const { queue, calls, state } = makeQueue({ listDelayMs: 1, pages: [[a, b]], gone });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await queue.publish(TOPIC, input()); // cache now holds a and b

    gone.add(b); // b's queue is deleted
    state.pages = [[a]];
    calls.sent.length = 0;
    await expect(queue.publish(TOPIC, input())).resolves.toEqual(expect.any(String));
    expect(calls.sent).toEqual([a]);

    // The dead URL is dropped and rediscovery is scheduled.
    await sleep(20);
    calls.sent.length = 0;
    await queue.publish(TOPIC, input());
    expect(calls.sent).toEqual([a]);
  });

  it("still rejects on a send error other than a deleted queue", async () => {
    const a = url(`${PREFIX}hrms-service`);
    const { queue } = makeQueue({ listDelayMs: 1, pages: [[a]] });
    const client = (queue as unknown as { client: { send: (c: Cmd) => Promise<unknown> } }).client;
    const orig = client.send;
    client.send = async (cmd: Cmd) => {
      if (cmd.constructor.name === "SendMessageCommand") throw new Error("throttled");
      return orig(cmd);
    };
    await expect(queue.publish(TOPIC, input())).rejects.toThrow("throttled");
  });
});
