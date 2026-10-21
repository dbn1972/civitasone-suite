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
import { runWithTenant } from "@civitasone/db";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
import { LEAD_SCORE_RECALC } from "../src/modules/leads/consumer.js";
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

/** Drive the real rule-based recalculation consumer for one lead (what Save leads to). */
async function recalc(leadId: string, tenantId: string): Promise<void> {
  const { handlerFor } = captureHandlers();
  const handler = handlerFor(LEAD_SCORE_RECALC);
  const msg = envelope(LEAD_SCORE_RECALC, { contactId: leadId, tenantId }, { tenantId, actorId: ACTOR });
  await runWithTenant(tenantId, () => handler(msg));
}
async function wipeTenant(t: string): Promise<void> {
  await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_history WHERE tenant_id = ${t}`);
  await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_rules WHERE tenant_id = ${t}`);
  await scoped(t, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`);
}

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
  // The preview scores the proposal OVERLAID on the stored rules (PUT is additive), so these
  // tests start from an explicit stored baseline: a single company rule that every proposal
  // below overrides or that is the only rule that scores.
  beforeAll(async () => {
    const res = await call("PUT", "/v1/crm/lead-score-rules", { payload: { rules: [presence("company", 40)] } });
    expect(res.statusCode).toBe(200);
  });

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
    expect(p.retainedRules).toBe(0); // the proposal overrides the only stored rule
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

  describe("scores what Save will really leave behind (stored rules the proposal omits still score)", () => {
    const seededRules = [presence("company", 50), presence("leadSource", 50)];

    /** Seed a tenant with two stored rules and two leads; returns the lead ids. */
    async function seedTenant(t: string): Promise<{ both: string; companyOnly: string }> {
      const put = await call("PUT", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t), payload: { rules: seededRules } });
      expect(put.statusCode).toBe(200);
      const both = await createLead("Company and source", { company: "Acme", leadSource: "referral" }, t);
      const companyOnly = await createLead("Company only", { company: "Beta" }, t);
      return { both, companyOnly };
    }
    const preview = (t: string, rules: unknown[]) =>
      call("POST", "/v1/crm/lead-score-rules/preview", { headers: headers(["crm_admin"], t), payload: { rules } });

    it("a rule left out of the proposal keeps contributing, and the preview equals the scores after Save", async () => {
      const t = randomUUID();
      try {
        const { both, companyOnly } = await seedTenant(t);

        // The editor dropped the leadSource rule, but Save never deletes it.
        const res = await preview(t, [presence("company", 50)]);
        expect(res.statusCode).toBe(200);
        const p = (res.json() as { data: { retainedRules: number; totalWeight: number; maxPossibleScore: number; proposedAverage: number } }).data;
        expect(p.retainedRules).toBe(1);
        expect(p.totalWeight).toBe(100); // company 50 + the retained leadSource 50
        expect(p.maxPossibleScore).toBe(100);
        expect(p.proposedAverage).toBe(75); // (100 + 50) / 2; scoring only the proposal would say 50

        // Save exactly that proposal, rescore through the real consumer, compare.
        const put = await call("PUT", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t), payload: { rules: [presence("company", 50)] } });
        expect(put.statusCode).toBe(200);
        const stored = (put.json() as { data: Array<{ attribute: string; enabled: boolean }> }).data;
        expect(stored.find((r) => r.attribute === "leadSource")?.enabled).toBe(true); // still there
        await recalc(both, t);
        await recalc(companyOnly, t);
        const scores = [await storedScore(both, t), await storedScore(companyOnly, t)];
        expect(scores).toEqual([100, 50]);
        expect((scores[0]! + scores[1]!) / 2).toBe(p.proposedAverage);
      } finally {
        await wipeTenant(t);
      }
    });

    it("disabling the rule in the proposal is what stops it scoring, and the preview says so", async () => {
      const t = randomUUID();
      try {
        const { both, companyOnly } = await seedTenant(t);

        const res = await preview(t, [presence("company", 50), { ...presence("leadSource", 50), enabled: false }]);
        const p = (res.json() as { data: { retainedRules: number; totalWeight: number; proposedAverage: number } }).data;
        expect(p.retainedRules).toBe(0); // the proposal covers it
        expect(p.totalWeight).toBe(50);
        expect(p.proposedAverage).toBe(50); // both leads score 50 on company alone

        const put = await call("PUT", "/v1/crm/lead-score-rules", {
          headers: headers(["crm_admin"], t),
          payload: { rules: [presence("company", 50), { ...presence("leadSource", 50), enabled: false }] },
        });
        expect(put.statusCode).toBe(200);
        await recalc(both, t);
        await recalc(companyOnly, t);
        expect([await storedScore(both, t), await storedScore(companyOnly, t)]).toEqual([50, 50]);
      } finally {
        await wipeTenant(t);
      }
    });

    it("a stored rule that is already disabled is not counted as retained", async () => {
      const t = randomUUID();
      try {
        const put = await call("PUT", "/v1/crm/lead-score-rules", {
          headers: headers(["crm_admin"], t),
          payload: { rules: [presence("company", 50), { ...presence("leadSource", 50), enabled: false }] },
        });
        expect(put.statusCode).toBe(200);
        const res = await preview(t, [presence("company", 50)]);
        const p = (res.json() as { data: { retainedRules: number; totalWeight: number } }).data;
        expect(p.retainedRules).toBe(0);
        expect(p.totalWeight).toBe(50);
      } finally {
        await wipeTenant(t);
      }
    });

    it("with no stored rules the preview is exactly the proposal (a first PUT creates just those rows)", async () => {
      const t = randomUUID();
      try {
        const res = await preview(t, [presence("company", 30)]);
        const p = (res.json() as { data: { retainedRules: number; totalWeight: number } }).data;
        expect(p.retainedRules).toBe(0);
        expect(p.totalWeight).toBe(30);
        // The dry run seeded nothing.
        const rows = (await scoped(t, (tx) => tx`SELECT count(*)::int AS n FROM crm.lead_score_rules WHERE tenant_id = ${t}`)) as unknown as Array<{ n: number }>;
        expect(rows[0]!.n).toBe(0);
      } finally {
        await wipeTenant(t);
      }
    });

    it("never reads another tenant's stored rules", async () => {
      const t = randomUUID();
      const other = randomUUID();
      try {
        const put = await call("PUT", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], other), payload: { rules: [presence("city", 70)] } });
        expect(put.statusCode).toBe(200);
        const res = await preview(t, [presence("company", 30)]);
        const p = (res.json() as { data: { retainedRules: number; totalWeight: number } }).data;
        expect(p.retainedRules).toBe(0);
        expect(p.totalWeight).toBe(30);
      } finally {
        await wipeTenant(t);
        await wipeTenant(other);
      }
    });
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

describe("a repeated attribute in one request is rejected (GAP-CRM-LEAD-SCORING-03)", () => {
  const dup = [presence("company", 10), presence("email", 20), presence("company", 99)];

  it("PUT answers 400 with a field error on the repeated entry and saves nothing", async () => {
    const t = randomUUID();
    try {
      const res = await call("PUT", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t), payload: { rules: dup } });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { code: string; fieldErrors: Array<{ field: string; message: string }> };
      expect(body.code).toBe("VALIDATION_FAILED");
      expect(body.fieldErrors.map((f) => f.field)).toEqual(["rules.2.attribute"]);
      expect(body.fieldErrors[0]!.message).toMatch(/more than one rule/i);
      // Nothing was written: the first read lazy-seeds the defaults, so company is its default 25, not 10 or 99.
      const get = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t) });
      const company = (get.json() as { data: Array<{ attribute: string; weight: number }> }).data.find((r) => r.attribute === "company");
      expect(company?.weight).toBe(25);
    } finally {
      await wipeTenant(t);
    }
  });

  it("preview answers the same 400, so a duplicate is never double counted", async () => {
    const res = await call("POST", "/v1/crm/lead-score-rules/preview", { payload: { rules: dup } });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { fieldErrors: Array<{ field: string }> };
    expect(body.fieldErrors.map((f) => f.field)).toEqual(["rules.2.attribute"]);
  });

  it("distinct attributes are still accepted", async () => {
    const res = await call("POST", "/v1/crm/lead-score-rules/preview", { payload: { rules: [presence("company", 10), presence("email", 20)] } });
    expect(res.statusCode).toBe(200);
  });
});

// GAP-CRM-LEAD-SCORING-02: the backend is authoritative for the params contract of each score
// function. A direct API call with params the scorer cannot read (e.g. recency `{ tiers: 5 }`)
// used to be saved and then made buildScoreFn throw on every recalculation and preview of the
// tenant; now it is a 400 with a field error on `rules.<i>.params...` and nothing is saved.
describe("score-function params are validated by the backend (GAP-CRM-LEAD-SCORING-02)", () => {
  const rule = (attribute: string, scoreFnType: string, params: unknown, weight = 10) => ({
    attribute, weight, scoreFnType, params, enabled: true,
  });

  // [label, rule, field that must carry the error]
  const rejected: Array<[string, ReturnType<typeof rule>, string]> = [
    ["recency tiers that is not an array", rule("lastActivityAt", "recency", { tiers: 5 }), "rules.0.params.tiers"],
    ["recency tier maxDays that is a string", rule("lastActivityAt", "recency", { tiers: [{ maxDays: "7", score: 10 }] }), "rules.0.params.tiers.0.maxDays"],
    ["recency tier with negative maxDays", rule("lastActivityAt", "recency", { tiers: [{ maxDays: -1, score: 10 }] }), "rules.0.params.tiers.0.maxDays"],
    ["recency tier score above 100", rule("lastActivityAt", "recency", { tiers: [{ maxDays: 7, score: 101 }] }), "rules.0.params.tiers.0.score"],
    ["recency beyondScore above 100", rule("lastActivityAt", "recency", { beyondScore: 150 }), "rules.0.params.beyondScore"],
    ["numeric_threshold tiers that is an object", rule("city", "numeric_threshold", { tiers: { min: 1, score: 5 } }), "rules.0.params.tiers"],
    ["numeric_threshold tier with no min", rule("city", "numeric_threshold", { tiers: [{ score: 50 }] }), "rules.0.params.tiers.0.min"],
    ["numeric_threshold default below 0", rule("city", "numeric_threshold", { default: -5 }), "rules.0.params.default"],
    ["map values that is an array", rule("leadSource", "map", { values: [] }), "rules.0.params.values"],
    ["map key with upper-case letters", rule("leadSource", "map", { values: { Referral: 90 } }), "rules.0.params.values.Referral"],
    ["map score that is not a number", rule("leadSource", "map", { values: { referral: "high" } }), "rules.0.params.values.referral"],
    ["map score above 100", rule("leadSource", "map", { values: { referral: 120 } }), "rules.0.params.values.referral"],
    ["presence present above 100", rule("company", "presence", { present: 101 }), "rules.0.params.present"],
    ["presence absent that is a string", rule("company", "presence", { absent: "0" }), "rules.0.params.absent"],
    ["params that is an array", rule("company", "presence", []), "rules.0.params"],
    ["params that is null", rule("company", "presence", null), "rules.0.params"],
    ["a score function the scorer does not have", rule("company", "linear", { max: 100 }), "rules.0.scoreFnType"],
  ];

  describe.each([
    ["PUT /v1/crm/lead-score-rules", "PUT" as const, "/v1/crm/lead-score-rules"],
    ["POST /v1/crm/lead-score-rules/preview", "POST" as const, "/v1/crm/lead-score-rules/preview"],
  ])("%s", (_name, method, url) => {
    it.each(rejected)("rejects %s with a 400 field error and changes nothing", async (_label, bad, field) => {
      const t = randomUUID();
      try {
        const before = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t) }); // seeds the defaults
        const res = await call(method, url, { headers: headers(["crm_admin"], t), payload: { rules: [bad] } });
        expect(res.statusCode).toBe(400);
        const body = res.json() as { code: string; fieldErrors: Array<{ field: string; message: string }> };
        expect(body.code).toBe("VALIDATION_FAILED");
        expect(body.fieldErrors.map((f) => f.field)).toContain(field);
        // Nothing was written, so the tenant's rules (and their version) are exactly as they were.
        const after = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t) });
        expect((after.json() as { version: string }).version).toBe((before.json() as { version: string }).version);
        expect((after.json() as { data: unknown[] }).data).toEqual((before.json() as { data: unknown[] }).data);
      } finally {
        await wipeTenant(t);
      }
    });
  });

  it("names the offending rule by position, so the editor can point at the right row", async () => {
    const res = await call("PUT", "/v1/crm/lead-score-rules", {
      payload: { rules: [presence("company", 10), rule("lastActivityAt", "recency", { tiers: 5 }, 20)] },
    });
    expect(res.statusCode).toBe(400);
    const fields = (res.json() as { fieldErrors: Array<{ field: string }> }).fieldErrors.map((f) => f.field);
    expect(fields).toEqual(["rules.1.params.tiers"]);
  });

  it("a rejected params shape never reaches the scorer: the tenant keeps recalculating", async () => {
    const t = randomUUID();
    try {
      const bad = await call("PUT", "/v1/crm/lead-score-rules", {
        headers: headers(["crm_admin"], t),
        payload: { rules: [rule("lastActivityAt", "recency", { tiers: 5 }, 25)] },
      });
      expect(bad.statusCode).toBe(400);
      const lead = await createLead("Still scored", { company: "Acme", email: "a@b.in" }, t);
      await recalc(lead, t); // would throw inside buildScoreFn had the bad rule been saved
      expect(await storedScore(lead, t)).not.toBeNull();
      const ok = await call("POST", "/v1/crm/lead-score-rules/preview", {
        headers: headers(["crm_admin"], t),
        payload: { rules: [presence("company", 40)] },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await wipeTenant(t);
    }
  });

  it("accepts every kind's real params, leaves keys the scorer ignores alone, and defaults omitted params", async () => {
    const t = randomUUID();
    try {
      const rules = [
        rule("company", "presence", { present: 70, absent: 20 }, 15),
        rule("leadSource", "map", { values: { referral: 90, cold_call: 30 }, default: 20, note: "kept" }, 25),
        rule("lastActivityAt", "recency", { tiers: [{ maxDays: 7, score: 100 }, { maxDays: 30, score: 60 }], beyondScore: 20, absentScore: 10 }, 25),
        rule("city", "numeric_threshold", { tiers: [{ min: -5, score: 0 }, { min: 100, score: 80 }], default: 0 }, 15),
      ];
      const put = await call("PUT", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t), payload: { rules } });
      expect(put.statusCode).toBe(200);
      const stored = (put.json() as { data: Array<{ attribute: string; params: Record<string, unknown> }> }).data;
      expect(stored.find((r) => r.attribute === "leadSource")?.params).toEqual({ values: { referral: 90, cold_call: 30 }, default: 20, note: "kept" });
      expect(stored.find((r) => r.attribute === "city")?.params).toEqual({ tiers: [{ min: -5, score: 0 }, { min: 100, score: 80 }], default: 0 });

      // `params` may be omitted (it is `{}`), as before.
      const noParams = await call("PUT", "/v1/crm/lead-score-rules", {
        headers: headers(["crm_admin"], t),
        payload: { rules: [{ attribute: "email", weight: 5, scoreFnType: "presence", enabled: true }] },
      });
      expect(noParams.statusCode).toBe(200);
    } finally {
      await wipeTenant(t);
    }
  });

  it("the rules a GET returns (including the seeded defaults) go straight back through PUT", async () => {
    const t = randomUUID();
    try {
      const get = await call("GET", "/v1/crm/lead-score-rules", { headers: headers(["crm_admin"], t) });
      const current = (get.json() as { data: Array<{ attribute: string; weight: number; scoreFnType: string; params: unknown; enabled: boolean }> }).data;
      expect(current.length).toBeGreaterThan(0);
      const put = await call("PUT", "/v1/crm/lead-score-rules", {
        headers: headers(["crm_admin"], t),
        payload: { rules: current.map((r) => ({ attribute: r.attribute, weight: r.weight, scoreFnType: r.scoreFnType, params: r.params, enabled: r.enabled })) },
      });
      expect(put.statusCode).toBe(200);
    } finally {
      await wipeTenant(t);
    }
  });
});
