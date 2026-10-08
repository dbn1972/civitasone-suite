/**
 * GAP2-CRM-DEDUP-CANDIDATES-07 — list + dismiss HTTP round-trip.
 *
 * Seeds two near-duplicate contacts (same name + company), loads the real
 * `GET /v1/crm/contacts/dedup-candidates` list, asserts at least one pair
 * renders, dismisses it (`PATCH .../:pairId/dismiss` → 2xx), and asserts the
 * dismissed pair no longer appears and an audit event was written.
 *
 * On the OLD code neither route existed: the list GET 404'd (page showed a
 * permanent DataSourceBadge error) and the dismiss PATCH 404'd unconditionally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const CONTACT_A = randomUUID();
const CONTACT_B = randomUUID();

function headers(roles: string[] = ["crm_user"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dc" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function call(
  method: "GET" | "PATCH",
  url: string,
  opts: { roles?: string[]; payload?: unknown; noAuth?: boolean } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: headers(opts.roles) }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.dedup_dismissals WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.dedup_rules WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
  // Two near-duplicate contacts: identical name + company (name is a fuzzy rule,
  // company a fuzzy rule in the default rule set) => a flagged pair. A third,
  // distinct contact must NOT pair with them.
  await scoped((tx) => tx`
    INSERT INTO crm.contacts (id, tenant_id, name, company, lead_status, status, version, created_at, updated_at, created_by, updated_by)
    VALUES
      (${CONTACT_A}, ${TENANT}, 'Priya Sharma', 'Nimbus Pvt Ltd', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
      (${CONTACT_B}, ${TENANT}, 'Priya Sharma', 'Nimbus Pvt Ltd', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
      (${randomUUID()}, ${TENANT}, 'Unrelated Person', 'Different Org', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
  `);
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET /v1/crm/contacts/dedup-candidates", () => {
  it("401 without a token", async () => {
    expect((await call("GET", "/v1/crm/contacts/dedup-candidates", { noAuth: true })).statusCode).toBe(401);
  });

  it("returns at least one flagged pair for the seeded near-duplicates", async () => {
    const res = await call("GET", "/v1/crm/contacts/dedup-candidates");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ pairId: string; confidence: number; left: { id: string }; right: { id: string } }> };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const pair = body.data.find(
      (p) => [p.left.id, p.right.id].sort().join(":") === [CONTACT_A, CONTACT_B].sort().join(":"),
    );
    expect(pair).toBeDefined();
    expect(pair!.confidence).toBeGreaterThan(0);
  });
});

describe("PATCH /v1/crm/contacts/dedup-candidates/:pairId/dismiss", () => {
  it("dismisses a pair (2xx), hides it from the list, and writes an audit event", async () => {
    const list = await call("GET", "/v1/crm/contacts/dedup-candidates");
    const pairId = (list.json() as { data: Array<{ pairId: string }> }).data[0]!.pairId;

    const dismiss = await call("PATCH", `/v1/crm/contacts/dedup-candidates/${pairId}/dismiss`, {
      payload: { reason: "Confirmed distinct people after a call" },
    });
    expect(dismiss.statusCode).toBe(200);

    const after = await call("GET", "/v1/crm/contacts/dedup-candidates");
    const stillThere = (after.json() as { data: Array<{ pairId: string }> }).data.some((p) => p.pairId === pairId);
    expect(stillThere).toBe(false);

    const audit = (await scoped((tx) => tx`
      SELECT COUNT(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND payload->>'action' = 'dedup_candidate_dismiss'
    `)) as unknown as Array<{ n: number }>;
    expect(audit[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it("rejects a malformed pairId with 400", async () => {
    expect(
      (await call("PATCH", "/v1/crm/contacts/dedup-candidates/not-a-pair/dismiss", { payload: {} })).statusCode,
    ).toBe(400);
  });
});
