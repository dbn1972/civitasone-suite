/**
 * Stabilisation of the integrated CRM branch -- GAP-CRM-LEAD-SCORING-03 (a legacy rule can be retired).
 *
 * A scoring rule saved before the scoreable-attribute allow-list existed can sit on a field the
 * scorer does not read. PUT is an additive upsert by attribute, so such a rule can never be deleted;
 * and because the validator answered 400 on `rules.<i>.attribute` even for a PUT that merely
 * DISABLED it, an admin could neither remove it nor switch it off, and the rule kept scoring every
 * lead against `undefined` (a constant) forever.
 *
 * Now a rule on an unscoreable field is accepted ONLY when it is disabled AND already stored for the
 * tenant. An enabled one, a new one, and another tenant's are still 400 on `rules.<i>.attribute`.
 *
 * Real route -> DB round trips (needs the disposable Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
import { LEAD_SCORE_RECALC } from "../src/modules/leads/consumer.js";
import { putScoreRulesBody, previewScoreRulesBody } from "../src/modules/leads/score-rules-validators.js";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;
const ACTOR = randomUUID();
const TENANTS: string[] = [];

function headers(tenantId: string): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["crm_admin"], sid: "sess-stab-legacy-rule" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

let app: FastifyInstance;
type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
async function api(method: "GET" | "PUT" | "POST", url: string, tenantId: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: headers(tenantId), ...(payload === undefined ? {} : { payload }) });
  await drainQueue();
  return res;
}

const presence = (attribute: string, weight: number, enabled = true, absent = 0) => ({
  attribute, weight, scoreFnType: "presence", params: { present: 100, absent }, enabled,
});

interface RuleView { attribute: string; weight: number; enabled: boolean; version: number }
async function rules(tenantId: string): Promise<RuleView[]> {
  const res = await api("GET", "/v1/crm/lead-score-rules", tenantId);
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: RuleView[] }).data;
}
async function listVersion(tenantId: string): Promise<string> {
  const res = await api("GET", "/v1/crm/lead-score-rules", tenantId);
  return (res.json() as { version: string }).version;
}

/** A tenant that already has the code-default rules plus a legacy rule on `industry` (a field the scorer never reads). */
async function tenantWithLegacyRule(opts: { enabled?: boolean } = {}): Promise<string> {
  const t = randomUUID();
  TENANTS.push(t);
  await rules(t); // lazy-seeds the four default rules
  await scoped(t, (tx) => tx`
    INSERT INTO crm.lead_score_rules (tenant_id, attribute, weight, score_fn_type, params, enabled, created_by, updated_by)
    VALUES (${t}, 'industry', 10, 'presence', ${JSON.stringify({ present: 100, absent: 100 })}::jsonb, ${opts.enabled ?? true}, ${ACTOR}, ${ACTOR})
  `);
  return t;
}

async function leadScore(tenantId: string): Promise<{ leadId: string; recalc: () => Promise<number | null> }> {
  const res = await api("POST", "/v1/crm/contacts", tenantId, { name: `Legacy rule lead ${randomUUID().slice(0, 6)}` });
  expect(res.statusCode).toBe(202);
  const leadId = (res.json() as { id: string }).id;
  const { handlerFor } = captureHandlers();
  return {
    leadId,
    recalc: async () => {
      const msg = envelope(LEAD_SCORE_RECALC, { contactId: leadId, tenantId }, { tenantId, actorId: ACTOR });
      await runWithTenant(tenantId, () => handlerFor(LEAD_SCORE_RECALC)(msg));
      const rows = (await scoped(tenantId, (tx) => tx`SELECT score FROM crm.contacts WHERE id = ${leadId} AND tenant_id = ${tenantId}`)) as unknown as Array<{ score: number | null }>;
      return rows[0]?.score ?? null;
    },
  };
}

async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_history WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_score_rules WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`);
  }
}

beforeAll(async () => {
  app = await buildApp();
  registerAllConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

const fieldsOf = (res: { json: () => unknown }) => ((res.json() as { fieldErrors?: Array<{ field: string }> }).fieldErrors ?? []).map((f) => f.field);

describe("the validator: an unscoreable field is acceptable only for a DISABLED rule", () => {
  it("accepts a disabled rule on an unscoreable field (shape only: the routes also require it to be stored)", () => {
    expect(putScoreRulesBody.safeParse({ rules: [presence("industry", 10, false)] }).success).toBe(true);
    expect(previewScoreRulesBody.safeParse({ rules: [presence("industry", 10, false)] }).success).toBe(true);
  });

  it("still rejects an ENABLED rule on an unscoreable field, with the same field error as before", () => {
    for (const schema of [putScoreRulesBody, previewScoreRulesBody]) {
      const r = schema.safeParse({ rules: [presence("company", 10), presence("industry", 10, true)] });
      expect(r.success).toBe(false);
      const issues = r.success ? [] : r.error.issues;
      expect(issues.map((i) => i.path.join("."))).toEqual(["rules.1.attribute"]);
      expect(issues[0]!.message).toMatch(/scoreable lead field/i);
    }
  });

  it("an enabled rule defaults to enabled, so an omitted flag is still rejected on an unscoreable field", () => {
    const { enabled: _enabled, ...noFlag } = presence("industry", 10);
    expect(putScoreRulesBody.safeParse({ rules: [noFlag] }).success).toBe(false);
  });

  it("still enforces the rest of the contract on a disabled legacy rule (weight range, one rule per field)", () => {
    expect(putScoreRulesBody.safeParse({ rules: [presence("industry", 101, false)] }).success).toBe(false);
    const dup = putScoreRulesBody.safeParse({ rules: [presence("industry", 10, false), presence("industry", 20, false)] });
    expect(dup.success).toBe(false);
    expect(dup.success ? [] : dup.error.issues.map((i) => i.path.join("."))).toEqual(["rules.1.attribute"]);
  });
});

describe("PUT /v1/crm/lead-score-rules: retiring a stored legacy rule", () => {
  it("switching a stored legacy rule off is accepted, stored disabled, and the other rules are untouched", async () => {
    const t = await tenantWithLegacyRule();
    const before = await rules(t);
    expect(before.find((r) => r.attribute === "industry")?.enabled).toBe(true);
    const versionBefore = await listVersion(t);

    const res = await api("PUT", "/v1/crm/lead-score-rules", t, { rules: [presence("industry", 10, false, 100)] });
    expect(res.statusCode).toBe(200);

    const after = await rules(t);
    expect(after.find((r) => r.attribute === "industry")).toMatchObject({ enabled: false, weight: 10 });
    for (const r of before.filter((b) => b.attribute !== "industry")) {
      expect(after.find((a) => a.attribute === r.attribute)).toMatchObject({ weight: r.weight, enabled: r.enabled, version: r.version });
    }
    expect(await listVersion(t)).not.toBe(versionBefore);
  });

  it("the retired rule stops scoring: the lead scores exactly what it scores without the rule", async () => {
    const t = await tenantWithLegacyRule();
    const lead = await leadScore(t);
    const withLegacy = await lead.recalc();
    // a rule on a field the scorer never reads adds its constant to EVERY lead: 10 points here
    expect(withLegacy).not.toBeNull();

    const res = await api("PUT", "/v1/crm/lead-score-rules", t, { rules: [presence("industry", 10, false, 100)] });
    expect(res.statusCode).toBe(200);
    const withoutLegacy = await lead.recalc();
    expect(withLegacy! - withoutLegacy!).toBe(10);
    expect(withoutLegacy).toBeLessThan(withLegacy!);
  });

  it("an ENABLED legacy rule is still refused, even though it is stored (validation is not loosened for enabled rules)", async () => {
    const t = await tenantWithLegacyRule();
    const res = await api("PUT", "/v1/crm/lead-score-rules", t, { rules: [presence("industry", 15, true)] });
    expect(res.statusCode).toBe(400);
    expect(fieldsOf(res)).toEqual(["rules.0.attribute"]);
    expect((await rules(t)).find((r) => r.attribute === "industry")).toMatchObject({ enabled: true, weight: 10 });
  });

  it("a retired rule cannot be switched back on", async () => {
    const t = await tenantWithLegacyRule({ enabled: false });
    const res = await api("PUT", "/v1/crm/lead-score-rules", t, { rules: [presence("industry", 10, true)] });
    expect(res.statusCode).toBe(400);
    expect(fieldsOf(res)).toEqual(["rules.0.attribute"]);
    expect((await rules(t)).find((r) => r.attribute === "industry")?.enabled).toBe(false);
  });

  it("a disabled rule on an unscoreable field that is NOT stored is a NEW rule: 400, nothing saved", async () => {
    const t = await tenantWithLegacyRule();
    const res = await api("PUT", "/v1/crm/lead-score-rules", t, { rules: [presence("madeUpField", 10, false)] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(fieldsOf(res)).toEqual(["rules.0.attribute"]);
    expect((res.json() as { fieldErrors: Array<{ message: string }> }).fieldErrors[0]!.message).toMatch(/scoreable lead field/i);
    expect((await rules(t)).map((r) => r.attribute)).not.toContain("madeUpField");
  });

  it("another tenant's stored legacy rule does not make the attribute acceptable", async () => {
    await tenantWithLegacyRule();
    const other = randomUUID();
    TENANTS.push(other);
    await rules(other); // seeded defaults only
    const res = await api("PUT", "/v1/crm/lead-score-rules", other, { rules: [presence("industry", 10, false)] });
    expect(res.statusCode).toBe(400);
    expect(fieldsOf(res)).toEqual(["rules.0.attribute"]);
    expect((await rules(other)).map((r) => r.attribute)).not.toContain("industry");
  });

  it("the whole PUT is refused when one entry is bad: the good rules in the same request are not saved either", async () => {
    const t = await tenantWithLegacyRule();
    const company = (await rules(t)).find((r) => r.attribute === "company")!;
    const res = await api("PUT", "/v1/crm/lead-score-rules", t, {
      rules: [presence("company", company.weight + 7), presence("madeUpField", 10, false)],
    });
    expect(res.statusCode).toBe(400);
    expect(fieldsOf(res)).toEqual(["rules.1.attribute"]);
    expect((await rules(t)).find((r) => r.attribute === "company")?.weight).toBe(company.weight);
  });

  it("a retired and a normal rule can be saved together, and a stale version is still a 409", async () => {
    const t = await tenantWithLegacyRule();
    const version = await listVersion(t);
    const ok = await api("PUT", "/v1/crm/lead-score-rules", t, {
      rules: [presence("industry", 10, false), presence("city", 5)],
      version,
    });
    expect(ok.statusCode).toBe(200);
    const stale = await api("PUT", "/v1/crm/lead-score-rules", t, { rules: [presence("industry", 10, false)], version });
    expect(stale.statusCode).toBe(409);
  });
});

describe("POST /v1/crm/lead-score-rules/preview: same rule for the dry run", () => {
  it("previews a stored legacy rule that is switched off; refuses an enabled one and an unknown one", async () => {
    const t = await tenantWithLegacyRule();
    const ok = await api("POST", "/v1/crm/lead-score-rules/preview", t, { rules: [presence("industry", 10, false)] });
    expect(ok.statusCode).toBe(200);

    const enabled = await api("POST", "/v1/crm/lead-score-rules/preview", t, { rules: [presence("industry", 10, true)] });
    expect(enabled.statusCode).toBe(400);
    expect(fieldsOf(enabled)).toEqual(["rules.0.attribute"]);

    const unknown = await api("POST", "/v1/crm/lead-score-rules/preview", t, { rules: [presence("madeUpField", 10, false)] });
    expect(unknown.statusCode).toBe(400);
    expect(fieldsOf(unknown)).toEqual(["rules.0.attribute"]);
  });
});
