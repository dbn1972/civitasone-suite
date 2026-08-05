/**
 * BOOT-NONBLOCK: SqsQueue.start() must return immediately.
 *
 * Every service worker does `await queue.start(); const relay = startRelay(...)`.
 * The warm-up loop inside start() serially creates 54-143 SQS queues; against a
 * slow/loaded SQS (LocalStack answers at 6-10s/op) that took many minutes, so
 * startRelay was never reached and the outbox never drained. start() now runs
 * the warm-up + poll-loop setup in a DETACHED task and returns at once. These
 * tests pin that non-blocking behaviour AND the invariants it must preserve:
 * the warm-up stays serial (no boot burst), poll loops still start after the
 * warm, and stop() awaits the detached startup so a racing shutdown leaks no
 * orphan poll loops.
 */
import { describe, it, expect, afterEach } from "vitest";
import { SqsQueue } from "../src/bus.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Private surface we drive/inspect for these unit tests. */
type Internals = {
  getOrCreateQueue: (topic: string) => Promise<string>;
  pollTopic: (topic: string) => Promise<void>;
  polling: boolean;
  pollLoops: Promise<void>[];
  startupTask: Promise<void> | null;
};

function makeQueue(topics: string[]) {
  const queue = new SqsQueue();
  for (const t of topics) queue.subscribe(t, async () => {});
  const internals = queue as unknown as Internals;
  return { queue, internals };
}

describe("SqsQueue.start() is non-blocking", () => {
  const live: SqsQueue[] = [];
  afterEach(async () => {
    // Drain any poll-loop stubs (they spin until polling flips false).
    await Promise.all(live.splice(0).map((q) => q.stop()));
  });

  it("resolves before a slow getOrCreateQueue completes (proves non-blocking)", async () => {
    const topics = ["topic.a", "topic.b", "topic.c"];
    const { queue, internals } = makeQueue(topics);
    live.push(queue);

    let released = false;
    let firstStarted = false;
    // The first queue-create blocks on a gate we never open before asserting.
    const gate = new Promise<void>((resolve) => {
      // captured so we can open it after the assertions
      (queue as unknown as { __open: () => void }).__open = () => {
        released = true;
        resolve();
      };
    });
    internals.getOrCreateQueue = async (topic: string) => {
      if (topic === topics[0]) {
        firstStarted = true;
        await gate;
      }
      return `https://sqs/${topic}`;
    };
    internals.pollTopic = async () => {
      while (internals.polling) await sleep(5);
    };

    const t0 = Date.now();
    await queue.start();
    const elapsed = Date.now() - t0;

    // start() returned though the first create is still gated open.
    expect(released).toBe(false);
    expect(elapsed).toBeLessThan(200);
    // The detached warm-up has begun (first create entered), proving work was
    // scheduled, not skipped.
    await sleep(10);
    expect(firstStarted).toBe(true);
    expect(released).toBe(false);

    (queue as unknown as { __open: () => void }).__open();
    await internals.startupTask;
  });

  it("keeps the warm-up serial — never two getOrCreateQueue in flight (no boot burst)", async () => {
    const topics = Array.from({ length: 8 }, (_, i) => `topic.${i}`);
    const { queue, internals } = makeQueue(topics);
    live.push(queue);

    let inFlight = 0;
    let maxInFlight = 0;
    const createOrder: string[] = [];
    internals.getOrCreateQueue = async (topic: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      createOrder.push(topic);
      await sleep(15);
      inFlight -= 1;
      return `https://sqs/${topic}`;
    };
    internals.pollTopic = async () => {
      while (internals.polling) await sleep(5);
    };

    await queue.start();
    await internals.startupTask;

    expect(maxInFlight).toBe(1);
    expect(createOrder).toEqual(topics); // serial, in subscription order
  });

  it("starts one poll loop per topic AFTER the warm-up finishes (consumers work)", async () => {
    const topics = ["a", "b", "c", "d"];
    const { queue, internals } = makeQueue(topics);
    live.push(queue);

    let warmCompleted = 0;
    let firstPollSawWarm = -1;
    const polled: string[] = [];
    internals.getOrCreateQueue = async (topic: string) => {
      await sleep(5);
      warmCompleted += 1;
      return `https://sqs/${topic}`;
    };
    internals.pollTopic = async (topic: string) => {
      if (polled.length === 0) firstPollSawWarm = warmCompleted;
      polled.push(topic);
      while (internals.polling) await sleep(5);
    };

    await queue.start();
    await internals.startupTask;

    // Every topic got a poll loop, and each is tracked for stop().
    expect(polled.sort()).toEqual([...topics].sort());
    expect(internals.pollLoops.length).toBe(topics.length);
    // The FIRST poll loop only ran once ALL warms had completed (serial-then-poll).
    expect(firstPollSawWarm).toBe(topics.length);
  });

  it("stop() awaits the detached startup and leaks no poll loops when it races a slow boot", async () => {
    const topics = ["x", "y", "z"];
    const { queue, internals } = makeQueue(topics);

    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);

    let warmCompleted = 0;
    let warmActiveAtStopResolve = -1;
    const polled: string[] = [];
    internals.getOrCreateQueue = async (topic: string) => {
      await sleep(20);
      warmCompleted += 1;
      return `https://sqs/${topic}`;
    };
    internals.pollTopic = async (topic: string) => {
      polled.push(topic);
      while (internals.polling) await sleep(5);
    };

    await queue.start();
    // Race a shutdown while the serial warm-up is still running.
    await sleep(10);
    await queue.stop();
    warmActiveAtStopResolve = warmCompleted;

    // stop() awaited the startup task: by the time it resolved the full serial
    // warm-up had completed (all topics), not just the one in flight at stop().
    expect(warmActiveAtStopResolve).toBe(topics.length);
    // Shutdown before poll-loop creation => no poll loops, nothing orphaned.
    expect(polled).toEqual([]);
    expect(internals.pollLoops.length).toBe(0);
    expect(internals.startupTask).not.toBeNull();

    await sleep(5);
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
