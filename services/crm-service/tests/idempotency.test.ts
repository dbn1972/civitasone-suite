/**
 * R2 — command idempotency.
 *
 * A mutating POST that carries `x-idempotency-key` must derive both its entity
 * id and its queue messageId from that key, so a client retry collapses into
 * one row and one event instead of two.
 *
 * Keys are salted with a per-run uuid: derived messageIds land in
 * `_inbox.processed` permanently, so a fixed key would make the second run of
 * this file replay against an already-processed inbox.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { captureHandlers, drainQueue, envelope } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const ACTOR = "cccccccc-3333-4000-8000-000000000077";
const SUBJECT_ID = "77777777-dddd-4000-8000-000000000009";
const CLOSE_DEAL_ID = "77777777-eeee-4000-8000-000000000001";
const RUN = randomUUID();
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function headers(idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["crm_user"], sid: "sess-idem" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
  if (idempotencyKey) h["x-idempotency-key"] = idempotencyKey;
  return h;
}

async function post(url: string, payload: unknown, idempotencyKey?: string) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url, headers: headers(idempotencyKey), payload });
  await app.close();
  return res;
}

/**
 * Fire a double-submit the way a client does it — both requests in flight
 * before either consumer applies. Sequential injects would let the first write
 * land and the second request would then be rejected by the route's own
 * duplicate/state guard, which tests the guard rather than the derived id.
 */
async function doubleSubmit(url: string, payload: unknown, idempotencyKey: string) {
  const app = await buildApp();
  const both = await Promise.all([
    app.inject({ method: "POST", url, headers: headers(idempotencyKey), payload }),
    app.inject({ method: "POST", url, headers: headers(idempotencyKey), payload }),
  ]);
  await app.close();
  return both;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function dealIdsNamed(name: string): Promise<string[]> {
  const rows = await scoped((tx) => tx`
    SELECT id FROM crm.deals WHERE tenant_id = ${TENANT} AND name = ${name}
  `) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.next_actions WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.tenders WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await scoped(async (tx) => {
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, version, created_at, updated_at, created_by, updated_by)
      VALUES (${CLOSE_DEAL_ID}, ${TENANT}, 'Idem Close Deal', 'Negotiation', 900000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

describe("R2 idempotency — POST /v1/crm/deals", () => {
  it("returns the same deal id when the same idempotency key is retried", async () => {
    const body = { name: "Idem Retry Deal", valueMinor: 100000, currency: "INR" };
    const first = await post("/v1/crm/deals", body, `${RUN}:deal-retry`);
    const second = await post("/v1/crm/deals", body, `${RUN}:deal-retry`);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().id).toBe(first.json().id);

    await drainQueue();
    expect(await dealIdsNamed("Idem Retry Deal")).toEqual([first.json().id]);
  });

  it("creates two deals when the idempotency keys differ", async () => {
    const body = { name: "Idem Distinct Deal", valueMinor: 5000, currency: "INR" };
    const a = await post("/v1/crm/deals", body, `${RUN}:deal-a`);
    const b = await post("/v1/crm/deals", body, `${RUN}:deal-b`);

    expect(a.json().id).not.toBe(b.json().id);

    await drainQueue();
    expect(new Set(await dealIdsNamed("Idem Distinct Deal")))
      .toEqual(new Set([a.json().id, b.json().id]));
  });

  it("still allocates a fresh random id when no idempotency key is sent", async () => {
    const body = { name: "Idem Keyless Deal", valueMinor: 1, currency: "INR" };
    const a = await post("/v1/crm/deals", body);
    const b = await post("/v1/crm/deals", body);

    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(a.json().id).toMatch(UUID_SHAPE);
    expect(a.json().id).not.toBe(b.json().id);

    await drainQueue();
    expect((await dealIdsNamed("Idem Keyless Deal")).length).toBe(2);
  });

  it("does not collide two different commands that reuse one client key", async () => {
    const key = `${RUN}:shared-key`;
    const deal = await post("/v1/crm/deals", { name: "Idem Shared Key Deal", valueMinor: 10, currency: "INR" }, key);
    const action = await post("/v1/crm/next-actions", {
      subjectType: "deal", subjectId: SUBJECT_ID, actionType: "call",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, key);

    expect(deal.statusCode).toBe(202);
    expect(action.statusCode).toBe(202);
    expect(action.json().id).not.toBe(deal.json().id);
  });

  it("dedupes a redelivered create command at the consumer inbox", async () => {
    // Straight to the handler: the in-process bus keeps its own seen-set, so
    // only a direct second apply proves `_inbox.processed` is what stops the
    // duplicate insert (an undeduped replay would raise a PK violation here).
    const handler = captureHandlers().handlerFor(COMMANDS.createDeal);
    const id = randomUUID();
    const msg = envelope(COMMANDS.createDeal, {
      id, tenantId: TENANT, name: "Idem Redelivered Deal", stage: "Lead",
      pipelineId: null, stageId: null, valueMinor: "2500", currency: "INR",
      contactId: null, ownerId: ACTOR, closeDate: null, probability: 0,
      status: "active", version: 1,
    }, { tenantId: TENANT, actorId: ACTOR, messageId: id });

    await runWithTenant(TENANT, () => handler(msg));
    await runWithTenant(TENANT, () => handler(msg));

    expect(await dealIdsNamed("Idem Redelivered Deal")).toEqual([id]);
  });
});

describe("R2 idempotency — route-level creates", () => {
  it("POST /v1/crm/next-actions reuses the derived id and writes one row", async () => {
    const body = {
      subjectType: "deal", subjectId: SUBJECT_ID, actionType: "follow_up",
      dueAt: new Date(Date.now() + 172_800_000).toISOString(),
    };
    const first = await post("/v1/crm/next-actions", body, `${RUN}:action-retry`);
    const second = await post("/v1/crm/next-actions", body, `${RUN}:action-retry`);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().id).toBe(first.json().id);

    await drainQueue();
    const rows = await scoped((tx) => tx`
      SELECT id FROM crm.next_actions
      WHERE tenant_id = ${TENANT} AND action_type = 'follow_up'
    `) as unknown as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([first.json().id]);
  });

  it("POST /v1/crm/tenders survives a double-submit with one tender row", async () => {
    const tenderRef = `T-IDEM-${RUN.slice(0, 8)}`;
    const [first, second] = await doubleSubmit("/v1/crm/tenders", {
      tenderRef, title: "Idempotent tender", estimatedValueMinor: "750000", currency: "INR",
    }, `${RUN}:tender-retry`);

    expect(first?.statusCode).toBe(202);
    expect(second?.statusCode).toBe(202);
    expect(second?.json().id).toBe(first?.json().id);

    await drainQueue();
    const rows = await scoped((tx) => tx`
      SELECT id FROM crm.tenders WHERE tenant_id = ${TENANT} AND tender_ref = ${tenderRef}
    `) as unknown as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([first?.json().id]);
  });
});

describe("R2 idempotency — POST /v1/crm/deals/:id/close", () => {
  it("returns a stable id and closes the deal exactly once", async () => {
    const [first, second] = await doubleSubmit(
      `/v1/crm/deals/${CLOSE_DEAL_ID}/close`,
      { outcome: "won", closedValue: "150000" },
      `${RUN}:deal-close`,
    );

    expect(first?.statusCode).toBe(202);
    expect(second?.statusCode).toBe(202);
    expect(second?.json().id).toBe(first?.json().id);

    await drainQueue();
    const deals = await scoped((tx) => tx`
      SELECT stage, version FROM crm.deals WHERE id = ${CLOSE_DEAL_ID} AND tenant_id = ${TENANT}
    `) as unknown as Array<{ stage: string; version: number }>;
    expect(deals[0]?.stage).toBe("Won");
    expect(deals[0]?.version).toBe(2);

    // Two distinct messageIds would have produced a second (rejected) close
    // event alongside the real one.
    const events = await scoped((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = ${EVENTS.dealClosed}
        AND payload->>'dealId' = ${CLOSE_DEAL_ID}
    `) as unknown as Array<{ n: number }>;
    expect(events[0]?.n).toBe(1);
  });
});
