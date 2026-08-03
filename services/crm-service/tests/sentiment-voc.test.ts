/**
 * Voice-of-Customer end to end (P2-6).
 *
 * The trigger is the analyse COMMAND relayed from the activities module's outbox, so
 * these tests drive the real production path: log an activity over HTTP → the activity
 * consumer commits the row and the analyse command into the outbox → the outbox is
 * relayed onto the bus → the sentiment consumer scores and stores the reading.
 * `relayTenantEvents` is the worker's relay narrowed to one tenant (same contract:
 * messageId = outbox row id) so a parallel test file's messages are not consumed out
 * from under it.
 *
 * Writes are CQRS: routes return 202 and state is asserted through the read path only
 * after the queue has drained.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000a6";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000a6";
const ACTOR_A = "cccccccc-3333-4000-8000-0000000000a6";
const ACTOR_B = "dddddddd-4444-4000-8000-0000000000a6";

interface SentimentRow {
  id: string;
  activityId: string;
  activityType: string;
  polarity: string;
  score: number;
  themes: string[];
  excerpt: string | null;
  model: string;
}

interface VocSummary {
  total: number;
  byPolarity: { positive: number; neutral: number; negative: number };
  averageScore: number;
  negativeShare: number;
  topThemes: { theme: string; count: number; negativeCount: number }[];
  truncated: boolean;
}

function headers(
  tenantId: string = TENANT_A,
  actorId: string = ACTOR_A,
  roles: string[] = ["crm_admin"],
): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-voc" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "POST",
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    headers: opts.headers ?? headers(),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** The worker's outbox relay, scoped to one tenant. */
async function relayTenantEvents(tenantId: string): Promise<void> {
  const rows = (await scoped(
    tenantId,
    (tx) => tx`
    SELECT id, topic, event_type AS "eventType", tenant_id AS "tenantId",
           actor_id AS "actorId", correlation_id AS "correlationId", payload
    FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND published_at IS NULL
    ORDER BY created_at
  `,
  )) as unknown as Array<{
    id: string;
    topic: string;
    eventType: string;
    tenantId: string;
    actorId: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }>;

  await scoped(
    tenantId,
    (tx) => tx`
    UPDATE _outbox.messages SET published_at = now()
    WHERE tenant_id = ${tenantId} AND published_at IS NULL
  `,
  );

  for (const row of rows) {
    await queue.publish(row.topic, {
      messageId: row.id,
      type: row.eventType,
      tenantId: row.tenantId,
      actorId: row.actorId,
      correlationId: row.correlationId,
      schemaVersion: "1.0",
      payload: row.payload,
    });
  }
  await drainQueue();
}

/** Log an interaction and run it all the way through to a stored reading. */
async function logInteraction(
  text: string,
  opts: { type?: string; tenantId?: string; actorId?: string } = {},
): Promise<string> {
  const tenantId = opts.tenantId ?? TENANT_A;
  const actorId = opts.actorId ?? ACTOR_A;
  const res = await call("POST", "/v1/crm/activities", {
    headers: headers(tenantId, actorId),
    payload: { actorName: "Test Officer", text, type: opts.type ?? "note" },
  });
  expect([201, 202]).toContain(res.statusCode);
  const activityId = (res.json() as { id: string }).id;
  await relayTenantEvents(tenantId);
  return activityId;
}

async function listSentiments(
  query = "",
  hdrs?: Record<string, string>,
): Promise<SentimentRow[]> {
  const res = await call(
    "GET",
    `/v1/crm/sentiment?limit=200${query}`,
    hdrs ? { headers: hdrs } : {},
  );
  expect(res.statusCode).toBe(200);
  return res.json().data as SentimentRow[];
}

async function summary(query = ""): Promise<VocSummary> {
  const res = await call("GET", `/v1/crm/sentiment/summary${query}`);
  expect(res.statusCode).toBe(200);
  return res.json().data as VocSummary;
}

async function summaryFor(
  tenantId: string,
  actorId: string,
): Promise<VocSummary> {
  const res = await call("GET", "/v1/crm/sentiment/summary", {
    headers: headers(tenantId, actorId),
  });
  expect(res.statusCode).toBe(200);
  return res.json().data as VocSummary;
}

async function readingFor(
  activityId: string,
): Promise<SentimentRow | undefined> {
  return (await listSentiments()).find((r) => r.activityId === activityId);
}

/** Domain events announcing a score for one activity, oldest first. */
async function scoredEventsFor(activityId: string): Promise<unknown[]> {
  const rows = (await scoped(
    TENANT_A,
    (tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${TENANT_A}
      AND event_type = 'crm.interaction.sentiment_scored'
      AND payload->>'activityId' = ${activityId}
    ORDER BY created_at
  `,
  )) as unknown as Array<{ payload: unknown }>;
  return rows.map((r) => r.payload);
}

/** Audit entries recorded against one activity by the sentiment consumer. */
async function auditActionsFor(activityId: string): Promise<string[]> {
  const rows = (await scoped(
    TENANT_A,
    (tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${TENANT_A}
      AND event_type = 'audit.event.record'
      AND payload->>'action' = 'score'
      AND payload->>'resourceId' = ${activityId}
    ORDER BY created_at
  `,
  )) as unknown as Array<{ payload: { action: string } }>;
  return rows.map((r) => r.payload.action);
}

describe("P2-6 Voice of Customer", () => {
  beforeAll(async () => {
    registerAllConsumers(queue);
    await queue.start();
  });

  describe("scoring pipeline", () => {
    it("scores a complaint negative and stores its themes", async () => {
      const id = await logInteraction(
        "This is unacceptable — the bill is wrong and the payment has been delayed again.",
      );
      const reading = await readingFor(id);
      expect(
        reading,
        "a logged interaction should produce a reading",
      ).toBeDefined();
      expect(reading?.polarity).toBe("negative");
      expect(reading?.score).toBeLessThan(0);
      expect(reading?.themes).toContain("billing");
      expect(reading?.themes).toContain("delay");
    });

    it("scores praise positive", async () => {
      const id = await logInteraction(
        "Thank you, the officer was very helpful and courteous.",
      );
      const reading = await readingFor(id);
      expect(reading?.polarity).toBe("positive");
      expect(reading?.score).toBeGreaterThan(0);
    });

    it("records which scorer produced the reading", async () => {
      const id = await logInteraction("The service was excellent.");
      expect((await readingFor(id))?.model).toBe("lexicon-v1");
    });

    it("carries the activity type through so reporting can filter on it", async () => {
      const id = await logInteraction("Customer is furious about the delay.", {
        type: "complaint",
      });
      expect((await readingFor(id))?.activityType).toBe("complaint");
    });

    it("keeps an excerpt so a reading can be explained", async () => {
      const text = "The clerk was rude and refused to accept the document.";
      const id = await logInteraction(text);
      expect((await readingFor(id))?.excerpt).toBe(text);
    });

    it("truncates a long excerpt rather than storing the whole interaction again", async () => {
      const id = await logInteraction(`terrible service. ${"x".repeat(600)}`);
      const excerpt = (await readingFor(id))?.excerpt ?? "";
      expect(excerpt.length).toBeLessThanOrEqual(280);
    });
  });

  describe("idempotency", () => {
    it("scores an interaction exactly once even if the command is redelivered", async () => {
      const id = await logInteraction(
        "The portal login is broken and nobody has responded.",
      );
      const before = (await listSentiments()).filter(
        (r) => r.activityId === id,
      );
      expect(before).toHaveLength(1);

      // Same activity, a brand new messageId: markProcessed cannot help here, so
      // this proves the ON CONFLICT guard is what stops a double count.
      await queue.publish(COMMANDS.analyseSentiment, {
        messageId: randomUUID(),
        type: COMMANDS.analyseSentiment,
        tenantId: TENANT_A,
        actorId: ACTOR_A,
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: {
          activityId: id,
          activityType: "note",
          contactId: null,
          dealId: null,
          text: "completely different text that would score differently",
        },
      });
      await drainQueue();

      const after = (await listSentiments()).filter((r) => r.activityId === id);
      expect(
        after,
        "a replayed analyse must not add a second reading",
      ).toHaveLength(1);
      expect(after[0]?.id).toBe(before[0]?.id);
    });

    it("stays silent when a duplicate is discarded, rather than announcing a phantom score", async () => {
      const id = await logInteraction(
        "The officer was excellent and very helpful.",
      );
      const emittedBefore = await scoredEventsFor(id);
      expect(
        emittedBefore,
        "the first scoring should announce itself once",
      ).toHaveLength(1);

      // A second analyse for the same activity, carrying text that would score the
      // opposite way. The insert is discarded — so emitting here would publish a
      // score that contradicts the stored one and audit a write that never happened.
      await queue.publish(COMMANDS.analyseSentiment, {
        messageId: randomUUID(),
        type: COMMANDS.analyseSentiment,
        tenantId: TENANT_A,
        actorId: ACTOR_A,
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: {
          activityId: id,
          activityType: "note",
          contactId: null,
          dealId: null,
          text: "This is terrible, awful and completely unacceptable.",
        },
      });
      await drainQueue();

      expect(
        await scoredEventsFor(id),
        "a discarded insert must not emit",
      ).toHaveLength(1);
      expect(
        await auditActionsFor(id),
        "a discarded insert must not audit",
      ).toHaveLength(1);
    });
  });

  describe("tenant isolation", () => {
    it("does not show one tenant's readings to another", async () => {
      const idA = await logInteraction(
        "Tenant A is extremely disappointed with the delay.",
      );
      await logInteraction(
        "Tenant B is delighted with the excellent service.",
        {
          tenantId: TENANT_B,
          actorId: ACTOR_B,
        },
      );

      const seenByB = await listSentiments("", headers(TENANT_B, ACTOR_B));
      expect(seenByB.some((r) => r.activityId === idA)).toBe(false);
    });

    it("keeps the summary scoped to the caller's tenant", async () => {
      // Absolute totals are shared with every other test in this file, so assert on
      // the DELTA instead: work done in tenant A must move A's total and leave B's
      // untouched. A leak in either direction fails this.
      const beforeA = await summaryFor(TENANT_A, ACTOR_A);
      const beforeB = await summaryFor(TENANT_B, ACTOR_B);

      await logInteraction(
        "Tenant A logs one more extremely disappointing delay.",
      );

      const afterA = await summaryFor(TENANT_A, ACTOR_A);
      const afterB = await summaryFor(TENANT_B, ACTOR_B);

      expect(afterA.total, "tenant A should see its own new reading").toBe(
        beforeA.total + 1,
      );
      expect(afterB.total, "tenant B must not see tenant A's reading").toBe(
        beforeB.total,
      );
    });
  });

  describe("summary", () => {
    it("reports a polarity mix that sums to the total", async () => {
      const s = await summary();
      const { positive, neutral, negative } = s.byPolarity;
      expect(positive + neutral + negative).toBe(s.total);
    });

    it("reports the negative share as a percentage of the total", async () => {
      const s = await summary();
      expect(s.negativeShare).toBe(
        Math.round((s.byPolarity.negative / s.total) * 100),
      );
    });

    it("ranks themes most frequent first", async () => {
      const counts = (await summary()).topThemes.map((t) => t.count);
      expect(counts).toEqual([...counts].sort((x, y) => y - x));
    });

    it("says when the scanned window was complete", async () => {
      expect((await summary()).truncated).toBe(false);
    });

    it("reports an empty window as zeroes rather than failing", async () => {
      const s = await summary(
        "?from=1990-01-01T00:00:00.000Z&to=1990-01-02T00:00:00.000Z",
      );
      expect(s.total).toBe(0);
      expect(s.averageScore).toBe(0);
      expect(s.negativeShare).toBe(0);
      expect(s.topThemes).toEqual([]);
    });
  });

  describe("filters", () => {
    it("narrows the list to one polarity", async () => {
      const rows = await listSentiments("&polarity=negative");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.polarity === "negative")).toBe(true);
    });

    it("narrows the list to one activity type", async () => {
      const rows = await listSentiments("&activityType=complaint");
      expect(rows.every((r) => r.activityType === "complaint")).toBe(true);
    });

    it("rejects an inverted date range instead of silently reporting nothing", async () => {
      const res = await call(
        "GET",
        "/v1/crm/sentiment/summary?from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error?.code ?? res.json().code).toBe("INVALID_RANGE");
    });

    it("rejects an unrecognised polarity rather than ignoring the filter", async () => {
      const res = await call("GET", "/v1/crm/sentiment?polarity=furious");
      expect(res.statusCode).toBe(400);
    });
  });

  describe("authorisation", () => {
    it("rejects an unauthenticated read", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/crm/sentiment/summary",
      });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("rejects a caller without a CRM role", async () => {
      const res = await call("GET", "/v1/crm/sentiment/summary", {
        headers: headers(TENANT_A, ACTOR_A, ["hr_user"]),
      });
      expect(res.statusCode).toBe(403);
    });

    it("allows a plain crm_user to read", async () => {
      const res = await call("GET", "/v1/crm/sentiment/summary", {
        headers: headers(TENANT_A, ACTOR_A, ["crm_user"]),
      });
      expect(res.statusCode).toBe(200);
    });

    it("exposes no write route — scoring cannot be asserted by hand", async () => {
      const res = await call("POST", "/v1/crm/sentiment", {
        payload: { polarity: "positive" },
      });
      expect([404, 405]).toContain(res.statusCode);
    });
  });
});
