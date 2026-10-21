/**
 * W2 crm cluster 07 -- GAP-CRM-LEAD-SCORING-03 / -04 (backend half).
 *
 *  -03: a scoring rule may only name a field the scorer actually evaluates
 *       (SCOREABLE_LEAD_ATTRIBUTES, the scorer's whole input). An unknown attribute
 *       is rejected on save and GET advertises the allowed list.
 *  -04: POST /v1/crm/lead-score-rules/preview dry-runs a PROPOSED rule set against
 *       the tenant's leads and reports the score distribution, persisting nothing.
 *
 * Real route -> DB round trips (needs the disposable Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import {
  SCOREABLE_LEAD_ATTRIBUTES,
  SCORE_ATTRIBUTE_COLUMNS,
  isScoreableAttribute,
  leadAttributesFromRow,
} from "../src/modules/leads/score-rules-domain.js";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-w2c7-score" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}
async function call(method: "GET" | "POST" | "PUT", url: string, opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
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
async function createLead(name: string, extra: Record<string, unknown>, tenantId = TENANT): Promise<string> {
  const res = await call("POST", "/v1/crm/contacts", { headers: headers(["crm_admin"], tenantId), payload: { name, ...extra } });
  expect(res.statusCode).toBe(202);
  return (res.json() as { id: string }).id;
}
async function setStoredScore(id: string, score: number | null, tenantId = TENANT) {
  await scoped(tenantId, (tx) => tx`UPDATE crm.contacts SET score = ${score} WHERE id = ${id} AND tenant_id = ${tenantId}`);
}
async function storedScore(id: string, tenantId = TENANT): Promise<number | null> {
  const rows = (await scoped(tenantId, (tx) => tx`SELECT score FROM crm.contacts WHERE id = ${id} AND tenant_id = ${tenantId}`)) as unknown as Array<{ score: number | null }>;
  return rows[0]?.score ?? null;
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

const presence = (attribute: string, weight: number) => ({
  attribute, weight, scoreFnType: "presence", params: { present: 100, absent: 0 }, enabled: true,
});

describe("scoreable-attribute allow-list (GAP-CRM-LEAD-SCORING-03)", () => {
  it("the allow-list is exactly the scorer's input and is derived from one table", () => {
    expect([...SCOREABLE_LEAD_ATTRIBUTES].sort()).toEqual(
      ["city", "company", "designation", "email", "lastActivityAt", "leadSource", "leadStatus", "phone"],
    );
    // The attribute map the scorer evaluates carries exactly the allow-listed keys, so a
    // rule on any listed attribute reads a real value and the two cannot drift apart.
    const attrs = leadAttributesFromRow({ lead_source: "referral", company: "Acme", last_activity_at: null, email: "a@b.in", phone: "1", lead_status: "new", city: "Pune", designation: "CTO" });
    expect(Object.keys(attrs).sort()).toEqual([...SCOREABLE_LEAD_ATTRIBUTES].sort());
    expect(attrs.leadSource).toBe("referral");
    expect(attrs.city).toBe("Pune");
    for (const a of Object.keys(SCORE_ATTRIBUTE_COLUMNS)) expect(isScoreableAttribute(a)).toBe(true);
    expect(isScoreableAttribute("industry")).toBe(false);
    expect(isScoreableAttribute("__proto__")).toBe(false);
    expect(isScoreableAttribute("toString")).toBe(false);
  });

  it("PUT rejects an unknown attribute with a field error and saves nothing", async () => {
    const t = randomUUID();
    const res = await call("PUT", "/v1/crm/lead-score-rules", {
      headers: headers(["crm_admin"], t),
      payload: { rules: [presence("industry", 10)] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string; fieldErrors: Array<{ field: string; message: string }> };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.fieldErrors.map((f) => f.field)).toContain("rules.0.attribute");
    expect(body.fieldErrors.find((f) => f.field === "rules.0.attribute")?.message).toMatch(/scoreable lead field/i);
    // Nothing was persisted for that tenant (the GET below lazy-seeds only the defaults).
    const get = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t) });
    expect((get.json() as { data: Array<{ attribute: string }> }).data.map((r) => r.attribute)).not.toContain("industry");
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_rules WHERE tenant_id = ${t}`);
  });

  it("PUT accepts every scoreable attribute (incl. the ones the old suggestion list missed)", async () => {
    const t = randomUUID();
    const res = await call("PUT", "/v1/crm/lead-score-rules", {
      headers: headers(["crm_admin"], t),
      payload: { rules: ["phone", "leadStatus", "city", "designation"].map((a) => presence(a, 5)) },
    });
    expect(res.statusCode).toBe(200);
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_rules WHERE tenant_id = ${t}`);
  });

  it("GET advertises the scoreable attributes in meta", async () => {
    const t = randomUUID();
    const res = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t) });
    expect(res.statusCode).toBe(200);
    const meta = (res.json() as { meta: { scoreableAttributes: string[] } }).meta;
    expect([...meta.scoreableAttributes].sort()).toEqual([...SCOREABLE_LEAD_ATTRIBUTES].sort());
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_rules WHERE tenant_id = ${t}`);
  });
});

describe("POST /v1/crm/lead-score-rules/preview (GAP-CRM-LEAD-SCORING-04)", () => {
  it("scores the tenant's leads with the proposed rules, reports the distribution, and persists nothing", async () => {
    const hi = await createLead("Has company", { company: "Acme" });
    const lo = await createLead("No company", {});
    const fresh = await createLead("Never scored", {});
    await setStoredScore(hi, 90);
    await setStoredScore(lo, 10);
    await setStoredScore(fresh, null);

    const rulesBefore = await call("GET", "/v1/crm/lead-score-rules");
    const res = await call("POST", "/v1/crm/lead-score-rules/preview", {
      payload: { rules: [presence("company", 100)] },
    });
    expect(res.statusCode).toBe(200);
    const p = (res.json() as { data: Record<string, unknown> & { bands: Array<{ label: string; current: number; proposed: number }> } }).data;
    expect(p.totalLeads).toBe(3);
    expect(p.sampled).toBe(3);
    expect(p.truncated).toBe(false);
    expect(p.unscored).toBe(1);
    expect(p.currentAverage).toBe(50); // (90 + 10) / 2 scored leads
    expect(p.proposedAverage).toBe(33.3); // (100 + 0 + 0) / 3
    expect(p.raised).toBe(1); // 90 -> 100
    expect(p.lowered).toBe(1); // 10 -> 0
    expect(p.changed).toBe(2);
    expect(p.totalWeight).toBe(100);
    expect(p.maxPossibleScore).toBe(100);
    const band = (label: string) => p.bands.find((b) => b.label === label)!;
    expect(band("0-19")).toMatchObject({ current: 1, proposed: 2 });
    expect(band("80-100")).toMatchObject({ current: 1, proposed: 1 });

    // Dry run: neither the stored rules nor any lead's score moved.
    const rulesAfter = await call("GET", "/v1/crm/lead-score-rules");
    expect((rulesAfter.json() as { version: string }).version).toBe((rulesBefore.json() as { version: string }).version);
    expect(await storedScore(hi)).toBe(90);
    expect(await storedScore(lo)).toBe(10);
    expect(await storedScore(fresh)).toBeNull();
  });

  it("states the ceiling when the enabled weights do not add up to 100 (the scorer divides by a fixed 100)", async () => {
    const res = await call("POST", "/v1/crm/lead-score-rules/preview", {
      payload: { rules: [presence("company", 25), presence("email", 15), { ...presence("city", 50), enabled: false }] },
    });
    expect(res.statusCode).toBe(200);
    const p = (res.json() as { data: { totalWeight: number; maxPossibleScore: number } }).data;
    expect(p.totalWeight).toBe(40); // the disabled 50 does not count
    expect(p.maxPossibleScore).toBe(40);
  });

  it("only looks at the caller's tenant", async () => {
    await createLead("Other tenant lead", { company: "Elsewhere" }, OTHER);
    const res = await call("POST", "/v1/crm/lead-score-rules/preview", { payload: { rules: [presence("company", 100)] } });
    expect((res.json() as { data: { totalLeads: number } }).data.totalLeads).toBe(3);
  });

  it("is admin-only (403), needs auth (401) and refuses an unknown attribute (400)", async () => {
    const body = { rules: [presence("company", 10)] };
    expect((await call("POST", "/v1/crm/lead-score-rules/preview", { headers: headers(["crm_user"]), payload: body })).statusCode).toBe(403);
    expect((await call("POST", "/v1/crm/lead-score-rules/preview", { noAuth: true, payload: body })).statusCode).toBe(401);
    expect((await call("POST", "/v1/crm/lead-score-rules/preview", { payload: { rules: [presence("industry", 10)] } })).statusCode).toBe(400);
  });
});
