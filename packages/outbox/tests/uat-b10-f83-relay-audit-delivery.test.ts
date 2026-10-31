/**
 * UAT B10-F83 (relay half): an audit event must not be marked published when
 * the bus delivered it to nobody.
 *
 * Live UAT, 2026-10-28 16:00-18:01 UTC: the audit consumer's queue did not
 * exist, SqsQueue.publish() found no subscriber queue, logged
 * `queue_publish_no_subscribers` and RESOLVED; relayOnce then set published_at
 * and the outbox row (the only durable copy) was considered done. 276 audit
 * events were lost that way and nothing could re-send them.
 *
 * The fake bus below behaves like SqsQueue with zero subscriber queues: it
 * resolves (delivers to nobody) unless the caller passes requireSubscribers,
 * in which case it rejects (see queue-service
 * tests/uat-b10-f83-sqs-no-subscribers.test.ts for the real SqsQueue side).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@civitasone/observability", () => ({
  incrementOutboxRelayFailure: vi.fn(),
  captureError: vi.fn((_e: unknown, ctx: Record<string, unknown>) => { obs.captured.push(ctx); }),
}));
const cap = vi.hoisted(() => ({ marked: [] as string[][], skipped: [] as string[][] }));
const obs = vi.hoisted(() => ({ captured: [] as Array<Record<string, unknown>> }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (col: unknown, vals: string[]) => {
      cap.marked.push(vals);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.inArray as any)(col, vals);
    },
    notInArray: (col: unknown, vals: string[]) => {
      cap.skipped.push([...vals]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.notInArray as any)(col, vals);
    },
  };
});

// eslint-disable-next-line import/first
import {
  relayOnce, purgeOutbox, REQUIRED_DELIVERY_TOPICS, resolveAuditOutboxRetentionDays, resetRelayBackoff,
  RELAY_STUCK_ATTEMPTS, RELAY_BACKOFF_MAX_MS, type DrizzleTx,
} from "../src/index.js";

type Queue = Parameters<typeof relayOnce>[1];

const row = (id: string, topic: string, createdAt?: Date) => ({
  id, topic, eventType: topic, tenantId: "t", actorId: "a", correlationId: "c", payload: {}, schemaVersion: "1.0",
  ...(createdAt ? { createdAt } : {}),
});

function makeDb(rows: ReturnType<typeof row>[]): DrizzleTx {
  return {
    select() {
      return { from() { return { where() { return { orderBy() { return { limit: async () => rows }; } }; } }; } };
    },
    update() {
      return { set() { return { where: async () => undefined }; } };
    },
  } as unknown as DrizzleTx;
}

/** SqsQueue semantics with no subscriber queue for any topic. */
function busWithNoSubscribers(): { queue: Queue; calls: Array<{ topic: string; options?: { requireSubscribers?: boolean } }> } {
  const calls: Array<{ topic: string; options?: { requireSubscribers?: boolean } }> = [];
  const queue = {
    publish: vi.fn(async (topic: string, input: { messageId?: string }, options?: { requireSubscribers?: boolean }) => {
      calls.push({ topic, options });
      if (options?.requireSubscribers) throw Object.assign(new Error(`no subscriber queue for topic ${topic}`), { name: "NoSubscribersError" });
      return input.messageId ?? "x"; // delivered to nobody, but "succeeds"
    }),
  } as unknown as Queue;
  return { queue, calls };
}

beforeEach(() => { cap.marked.length = 0; cap.skipped.length = 0; obs.captured.length = 0; resetRelayBackoff(); });

describe("UAT B10-F83 relay: audit events require a subscriber", () => {
  it("leaves an audit row unpublished when no subscriber queue exists (retried next cycle)", async () => {
    const { queue } = busWithNoSubscribers();
    const n = await relayOnce(makeDb([row("audit-1", "audit.event.record"), row("ev-1", "hrms.leave.applied")]), queue, 10, "hrms-service", 5);
    expect(n).toBe(1);
    const marked = cap.marked.flat();
    expect(marked).toContain("ev-1"); // ordinary events keep their fire-and-forget behaviour
    expect(marked).not.toContain("audit-1"); // the audit row stays in the outbox
  });

  it("asks the bus for guaranteed delivery on both audit topics only", async () => {
    const { queue, calls } = busWithNoSubscribers();
    await relayOnce(makeDb([row("a", "audit.event.record"), row("b", "audit.event.ingest"), row("c", "crm.lead.created")]), queue, 10, "svc", 5);
    const byTopic = Object.fromEntries(calls.map((c) => [c.topic, c.options?.requireSubscribers === true]));
    expect(byTopic).toEqual({ "audit.event.record": true, "audit.event.ingest": true, "crm.lead.created": false });
    expect([...REQUIRED_DELIVERY_TOPICS].sort()).toEqual(["audit.event.ingest", "audit.event.record"]);
  });
});

describe("UAT B10-F83 purge: audit rows outlive the general retention", () => {
  it("defaults to 30 days and ignores junk overrides", () => {
    expect(resolveAuditOutboxRetentionDays(undefined)).toBe(30);
    expect(resolveAuditOutboxRetentionDays("abc")).toBe(30);
    expect(resolveAuditOutboxRetentionDays("0")).toBe(30);
    expect(resolveAuditOutboxRetentionDays("45")).toBe(45);
  });

  it("the outbox DELETE excludes audit topics until the audit cutoff", async () => {
    const texts: string[] = [];
    const db = {
      execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
        texts.push(JSON.stringify(q));
        return { count: 0 };
      }),
    } as unknown as DrizzleTx;
    await purgeOutbox(db, 7, 1000);
    const outboxDelete = texts[0]!;
    expect(outboxDelete).toContain("topic NOT IN");
    expect(outboxDelete).toContain("audit.event.record");
    expect(outboxDelete).toContain('["30"]'); // audit cutoff: now() - interval '30 days'
    expect(outboxDelete).toContain(") OR published_at < ");
  });
});

describe("UAT B10-F83 relay: no head-of-line blocking behind stuck audit rows", () => {
  it("a failed row is skipped (backoff) on the next cycles, so newer rows of other topics get relayed", async () => {
    const { queue } = busWithNoSubscribers();
    // Cycle 1: the batch window is full of audit rows that cannot be delivered.
    await relayOnce(makeDb([row("a1", "audit.event.record"), row("a2", "audit.event.record")]), queue, 2, "svc", 5);
    expect(cap.marked.flat()).toEqual([]);
    // Cycle 2: the relay query now excludes the backed-off rows…
    await relayOnce(makeDb([row("e1", "hrms.leave.applied")]), queue, 2, "svc", 5);
    expect(cap.skipped.at(-1)!.sort()).toEqual(["a1", "a2"]);
    // …and the other topic's row is published.
    expect(cap.marked.flat()).toContain("e1");
  });

  it("keeps retrying with capped exponential backoff and reports a stuck row exactly once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { queue } = busWithNoSubscribers();
      const db = makeDb([row("s1", "audit.event.record")]);
      for (let i = 0; i < RELAY_STUCK_ATTEMPTS + 3; i++) {
        await relayOnce(db, queue, 10, "svc", 5);
        vi.setSystemTime(Date.now() + RELAY_BACKOFF_MAX_MS + 1);
      }
      const stuck = obs.captured.filter((c) => c.event === "outbox_relay_row_stuck");
      expect(stuck).toHaveLength(1);
      expect(stuck[0]).toMatchObject({ outboxId: "s1", topic: "audit.event.record" });
      expect(cap.marked.flat()).not.toContain("s1"); // never dropped, never marked published
    } finally {
      vi.useRealTimers();
    }
  });

  it("a row that later succeeds leaves the backoff set", async () => {
    let fail = true;
    const queue = { publish: vi.fn(async () => { if (fail) throw new Error("down"); return "x"; }) } as unknown as Queue;
    await relayOnce(makeDb([row("r1", "audit.event.record")]), queue, 10, "svc", 5);
    fail = false;
    resetRelayBackoff(); // (wait elapsed)
    await relayOnce(makeDb([row("r1", "audit.event.record")]), queue, 10, "svc", 5);
    expect(cap.marked.flat()).toContain("r1");
    await relayOnce(makeDb([]), queue, 10, "svc", 5);
    expect(cap.skipped).toEqual([]);
  });
});

describe("UAT B10-F83 relay: audit events carry their commit time", () => {
  it("sends the outbox created_at as the envelope timestamp for audit topics only", async () => {
    const created = new Date("2026-10-28T18:30:00.000Z");
    const inputs: Array<{ topic: string; timestamp?: string }> = [];
    const queue = { publish: vi.fn(async (topic: string, input: { timestamp?: string }) => { inputs.push({ topic, timestamp: input.timestamp }); return "x"; }) } as unknown as Queue;
    await relayOnce(makeDb([row("a", "audit.event.record", created), row("b", "crm.lead.created", created)]), queue, 10, "svc", 5);
    expect(inputs.find((i) => i.topic === "audit.event.record")!.timestamp).toBe(created.toISOString());
    expect(inputs.find((i) => i.topic === "crm.lead.created")!.timestamp).toBeUndefined();
  });
});

describe("UAT B10-F83 purge: the consumer dedupe window can outlive the general one", () => {
  it("purges _inbox.processed with processedRetentionDays (never shorter than retentionDays)", async () => {
    const texts: string[] = [];
    const db = { execute: vi.fn(async (q: unknown) => { texts.push(JSON.stringify(q)); return { count: 0 }; }) } as unknown as DrizzleTx;
    await purgeOutbox(db, 7, 1000, 31);
    expect(texts[1]).toContain("_inbox.processed");
    expect(texts[1]).toContain('["31"]');
    texts.length = 0;
    await purgeOutbox(db, 7, 1000, 3);
    expect(texts[1]).toContain('["7"]');
  });
});
