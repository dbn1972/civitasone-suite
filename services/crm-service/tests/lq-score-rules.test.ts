/**
 * LQ-002 — configurable scoring rules (lazy-seeded defaults, admin PUT) and score
 * history written on every (re)score (score route + rule-based recalc consumer).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { runWithTenant } from "@civitasone/db";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
import { LEAD_SCORE_RECALC } from "../src/modules/leads/consumer.js";
import { EVENTS } from "../src/topics.js";

process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-sr" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}
async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method, url,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers() }),
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
async function createLead(name: string, extra: Record<string, unknown> = {}, tenantId = TENANT): Promise<string> {
  const res = await call("POST", "/v1/crm/contacts", { headers: headers(["crm_admin"], tenantId), payload: { name, ...extra } });
  return (res.json() as { id: string }).id;
}
async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_history WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_rules WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`);
  }
}
beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET/PUT /v1/crm/lead-score-rules", () => {
  it("seeds the code defaults on first read", async () => {
    const res = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], OTHER) });
    expect(res.statusCode).toBe(200);
    const attrs = (res.json() as { data: Array<{ attribute: string }> }).data.map((r) => r.attribute);
    expect(attrs).toEqual(expect.arrayContaining(["leadSource", "company", "lastActivityAt", "email"]));
  });

  it("upserts a rule and reflects it on the next read (durable)", async () => {
    const put = await call("PUT", "/v1/crm/lead-score-rules", {
      payload: { rules: [{ attribute: "email", weight: 55, scoreFnType: "presence", params: { present: 90, absent: 5 }, enabled: true }] },
    });
    expect(put.statusCode).toBe(200);
    const get = await call("GET", "/v1/crm/lead-score-rules");
    const email = (get.json() as { data: Array<{ attribute: string; weight: number }> }).data.find((r) => r.attribute === "email");
    expect(email?.weight).toBe(55);

    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT weight FROM crm.lead_score_rules WHERE tenant_id = ${TENANT} AND attribute = 'email'
    `)) as unknown as Array<Record<string, unknown>>;
    expect(Number(rows[0]!.weight)).toBe(55);
  });

  it("does not leak one tenant's rule change to another", async () => {
    await call("PUT", "/v1/crm/lead-score-rules", {
      payload: { rules: [{ attribute: "email", weight: 7, scoreFnType: "presence", params: {}, enabled: true }] },
    });
    const other = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], OTHER) });
    const email = (other.json() as { data: Array<{ attribute: string; weight: number }> }).data.find((r) => r.attribute === "email");
    expect(email?.weight).not.toBe(7);
  });

  it("401 without token; 403 for non-admin", async () => {
    expect((await call("GET", "/v1/crm/lead-score-rules", { noAuth: true })).statusCode).toBe(401);
    expect((await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_user"]) })).statusCode).toBe(403);
    expect((await call("PUT", "/v1/crm/lead-score-rules", { headers: headers(["crm_user"]), payload: { rules: [{ attribute: "x", weight: 1, scoreFnType: "presence", params: {}, enabled: true }] } })).statusCode).toBe(403);
  });

  it("400 for an invalid rule body", async () => {
    expect((await call("PUT", "/v1/crm/lead-score-rules", { payload: { rules: [{ attribute: "email", weight: 200, scoreFnType: "presence", params: {}, enabled: true }] } })).statusCode).toBe(400);
    expect((await call("PUT", "/v1/crm/lead-score-rules", { payload: { rules: [] } })).statusCode).toBe(400);
  });
});

describe("GET /v1/crm/leads/:id/score-history", () => {
  it("records a history row when the score route scores a lead", async () => {
    const leadId = await createLead("Score Route Lead", { email: "sr@example.com", company: "Acme", leadSource: "referral" });
    const scoreRes = await call("GET", `/v1/crm/leads/${leadId}/score`);
    expect(scoreRes.statusCode).toBe(200);

    const hist = await call("GET", `/v1/crm/leads/${leadId}/score-history`);
    expect(hist.statusCode).toBe(200);
    const data = (hist.json() as { data: Array<{ score: number; source: string }> }).data;
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(["rule", "ml"]).toContain(data[0]!.source);
  });

  it("records a rule-based history row when the score is recalculated", async () => {
    const leadId = await createLead("Recalc Lead", { email: "rc@example.com", leadSource: "website" });
    // Drive the recalc consumer directly (the route tests race their own cleanup);
    // this exercises the real recalculateScore → score-history write path.
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(LEAD_SCORE_RECALC);
    const msg = envelope(LEAD_SCORE_RECALC, { contactId: leadId, tenantId: TENANT }, { tenantId: TENANT, actorId: ACTOR });
    await runWithTenant(TENANT, () => handler(msg));

    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT source, score FROM crm.lead_score_history WHERE lead_id = ${leadId} AND tenant_id = ${TENANT} AND source = 'rule'
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(Number(rows[0]!.score)).toBeGreaterThanOrEqual(0);

    // The contact's score column was updated by the same recalculation.
    const c = (await scoped(TENANT, (tx) => tx`SELECT score FROM crm.contacts WHERE id = ${leadId} AND tenant_id = ${TENANT}`)) as unknown as Array<Record<string, unknown>>;
    expect(c[0]!.score).not.toBeNull();
  });

  it("readable by a plain crm_user", async () => {
    const leadId = await createLead("Readable Hist", { email: "rh@example.com" });
    await call("GET", `/v1/crm/leads/${leadId}/score`);
    const hist = await call("GET", `/v1/crm/leads/${leadId}/score-history`, { headers: headers(["crm_user"]) });
    expect(hist.statusCode).toBe(200);
  });

  it("does not append history on a repeated read that yields the same score (LQ-002 LOW)", async () => {
    const leadId = await createLead("Poll Lead", { email: "poll@example.com", company: "Poll Co", leadSource: "referral" });
    // First read records a row (score changed from nothing to a value).
    await call("GET", `/v1/crm/leads/${leadId}/score`);
    const countRow = () =>
      scoped(TENANT, (tx) => tx`SELECT count(*)::int AS n FROM crm.lead_score_history WHERE lead_id = ${leadId} AND tenant_id = ${TENANT}`) as unknown as Promise<Array<{ n: number }>>;
    const after1 = (await countRow())[0]!.n;
    expect(after1).toBeGreaterThanOrEqual(1);
    // Two more identical reads (same features → same score) must NOT append.
    await call("GET", `/v1/crm/leads/${leadId}/score`);
    await call("GET", `/v1/crm/leads/${leadId}/score`);
    const after3 = (await countRow())[0]!.n;
    expect(after3, "identical-score reads must not grow the history table").toBe(after1);
  });

  it("recalculates on a crm.contact.updated event", async () => {
    const leadId = await createLead("Updated Event Lead", { email: "ue@example.com", leadSource: "referral" });
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(EVENTS.contactUpdated);
    const msg = envelope(EVENTS.contactUpdated, { contactId: leadId }, { tenantId: TENANT, actorId: ACTOR });
    await runWithTenant(TENANT, () => handler(msg));

    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT source FROM crm.lead_score_history WHERE lead_id = ${leadId} AND tenant_id = ${TENANT} AND source = 'rule'
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores a contact.updated event with no contactId", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(EVENTS.contactUpdated);
    const msg = envelope(EVENTS.contactUpdated, {}, { tenantId: TENANT, actorId: ACTOR });
    await expect(runWithTenant(TENANT, () => handler(msg))).resolves.toBeUndefined();
  });
});
