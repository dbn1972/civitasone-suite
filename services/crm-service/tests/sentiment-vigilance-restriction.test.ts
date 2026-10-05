/**
 * Voice-of-Customer vigilance-theme restriction, enforced server-side (GAP-CRM-VOICE-OF-CUSTOMER-05).
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

const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000e7";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000e7";
const ACTOR_A = "cccccccc-3333-4000-8000-0000000000e7";
const ACTOR_B = "dddddddd-4444-4000-8000-0000000000e7";

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


describe("VoC vigilance theme restriction (server-side)", () => {
  beforeAll(async () => {
    registerAllConsumers(queue);
    await queue.start();
    await logInteraction("The clerk asked for a bribe, this is corruption");
    await logInteraction("Fee payment portal was quick and easy");
  });

  const hide = (r: { themes: string[] }) =>
    r.themes.includes("corruption") || r.themes.includes("staff_conduct");

  it("crm_user list omits readings tagged with a sensitive theme", async () => {
    const res = await call("GET", "/v1/crm/sentiment?limit=200", { headers: headers(TENANT_A, ACTOR_A, ["crm_user"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ themes: string[]; excerpt: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(hide)).toBe(false);
    expect(JSON.stringify(rows)).not.toMatch(/bribe/i);
  });

  it("crm_user summary has no sensitive themes in topThemes", async () => {
    const res = await call("GET", "/v1/crm/sentiment/summary", { headers: headers(TENANT_A, ACTOR_A, ["crm_user"]) });
    const s = res.json().data as { total: number; topThemes: { theme: string }[] };
    expect(s.topThemes.map((t) => t.theme)).not.toContain("corruption");
    expect(s.topThemes.map((t) => t.theme)).not.toContain("staff_conduct");
  });

  it("crm_admin still sees the sensitive readings and themes (cache variants do not leak)", async () => {
    const res = await call("GET", "/v1/crm/sentiment?limit=200", { headers: headers(TENANT_A, ACTOR_A, ["crm_admin"]) });
    expect((res.json().data as Array<{ themes: string[] }>).some(hide)).toBe(true);
    const sum = await call("GET", "/v1/crm/sentiment/summary", { headers: headers(TENANT_A, ACTOR_A, ["crm_admin"]) });
    expect((sum.json().data as { topThemes: { theme: string }[] }).topThemes.map((t) => t.theme)).toContain("corruption");
  });
});
