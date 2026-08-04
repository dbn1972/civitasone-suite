/**
 * LQ-001 — qualification frameworks CRUD, per-business-line lookup, and lead
 * qualification (compute outcome+score, persist via consumer, audit).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-q" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}
async function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {}) {
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
async function createLead(name: string, tenantId = TENANT): Promise<string> {
  const res = await call("POST", "/v1/crm/contacts", { headers: headers(["crm_admin"], tenantId), payload: { name } });
  return (res.json() as { id: string }).id;
}
const ENTERPRISE = {
  name: "Enterprise Fit",
  businessLine: "enterprise",
  questions: [
    { prompt: "Has an approved budget?", answerType: "bool", weight: 60, outcomeRule: { whenTrue: 100, whenFalse: 0 } },
    { prompt: "Annual deal value (paise)", answerType: "number", weight: 40, outcomeRule: { tiers: [{ min: 0, score: 20 }, { min: 10000000, score: 100 }], default: 0 } },
  ],
};

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_qualifications WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.qualification_frameworks WHERE tenant_id = ${t}`);
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

async function createFramework(body: unknown = ENTERPRISE, hdrs = headers()) {
  return call("POST", "/v1/crm/qualification-frameworks", { headers: hdrs, payload: body });
}

describe("qualification framework CRUD", () => {
  it("creates a framework with questions (201) and reads it back", async () => {
    const res = await createFramework();
    expect(res.statusCode).toBe(201);
    const fw = (res.json() as { data: { id: string; questions: unknown[] } }).data;
    expect(fw.id).toBeDefined();
    expect(fw.questions).toHaveLength(2);

    const got = await call("GET", `/v1/crm/qualification-frameworks/${fw.id}`);
    expect(got.statusCode).toBe(200);
    expect((got.json() as { data: { name: string } }).data.name).toBe("Enterprise Fit");
  });

  it("lists frameworks and filters by business line (the AC)", async () => {
    const a = (await createFramework({ ...ENTERPRISE, name: "SMB Fit", businessLine: "smb" })).json().data.id;
    const b = (await createFramework({ ...ENTERPRISE, name: "Govt Fit", businessLine: "govt" })).json().data.id;
    const res = await call("GET", "/v1/crm/qualification-frameworks?businessLine=govt");
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((f) => f.id);
    expect(ids).toContain(b);
    expect(ids).not.toContain(a);
  });

  it("updates a framework and replaces its questions", async () => {
    const id = (await createFramework()).json().data.id;
    const res = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, {
      payload: { name: "Renamed", active: false, questions: [{ prompt: "One?", answerType: "bool", weight: 100, outcomeRule: { whenTrue: 100, whenFalse: 0 } }] },
    });
    expect(res.statusCode).toBe(200);
    const fw = (res.json() as { data: { name: string; active: boolean; questions: unknown[] } }).data;
    expect(fw.name).toBe("Renamed");
    expect(fw.active).toBe(false);
    expect(fw.questions).toHaveLength(1);
  });

  it("deletes a framework", async () => {
    const id = (await createFramework()).json().data.id;
    const res = await call("DELETE", `/v1/crm/qualification-frameworks/${id}`);
    expect(res.statusCode).toBe(200);
    const got = await call("GET", `/v1/crm/qualification-frameworks/${id}`);
    expect(got.statusCode).toBe(404);
  });

  it("404s an unknown framework on GET/PUT/DELETE", async () => {
    const missing = randomUUID();
    expect((await call("GET", `/v1/crm/qualification-frameworks/${missing}`)).statusCode).toBe(404);
    expect((await call("PUT", `/v1/crm/qualification-frameworks/${missing}`, { payload: { name: "x" } })).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/crm/qualification-frameworks/${missing}`)).statusCode).toBe(404);
  });

  it("does not leak one tenant's frameworks to another", async () => {
    const id = (await createFramework({ ...ENTERPRISE, name: "Tenant A only" })).json().data.id;
    const res = await call("GET", "/v1/crm/qualification-frameworks", { headers: headers(["crm_admin"], OTHER) });
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((f) => f.id);
    expect(ids).not.toContain(id);
  });

  it("enforces admin role on create (403 for crm_user), allows read", async () => {
    expect((await createFramework(ENTERPRISE, headers(["crm_user"]))).statusCode).toBe(403);
    expect((await call("GET", "/v1/crm/qualification-frameworks", { headers: headers(["crm_user"]) })).statusCode).toBe(200);
  });

  it("400s an invalid framework body", async () => {
    expect((await createFramework({ businessLine: "x" })).statusCode).toBe(400);
  });
});

describe("POST /v1/crm/leads/:id/qualify", () => {
  async function seedFrameworkWithIds() {
    const fw = (await createFramework()).json().data as { id: string; questions: Array<{ id: string; answerType: string }> };
    const boolQ = fw.questions.find((q) => q.answerType === "bool")!;
    const numQ = fw.questions.find((q) => q.answerType === "number")!;
    return { frameworkId: fw.id, boolQ: boolQ.id, numQ: numQ.id };
  }

  it("computes outcome+score and persists a lead_qualification (round-trip)", async () => {
    const leadId = await createLead("Qualify Lead");
    const { frameworkId, boolQ, numQ } = await seedFrameworkWithIds();

    const res = await call("POST", `/v1/crm/leads/${leadId}/qualify`, {
      payload: { frameworkId, answers: { [boolQ]: true, [numQ]: 50000000 } },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { outcome: string; score: number; id: string };
    // 60*100 + 40*100 = 100 → qualified
    expect(body.score).toBe(100);
    expect(body.outcome).toBe("qualified");

    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT outcome, score FROM crm.lead_qualifications WHERE lead_id = ${leadId} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("qualified");
    expect(Number(rows[0]!.score)).toBe(100);

    const hist = await call("GET", `/v1/crm/leads/${leadId}/qualifications`);
    expect((hist.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it("scores a weak lead as disqualified", async () => {
    const leadId = await createLead("Weak Lead");
    const { frameworkId, boolQ, numQ } = await seedFrameworkWithIds();
    const res = await call("POST", `/v1/crm/leads/${leadId}/qualify`, {
      payload: { frameworkId, answers: { [boolQ]: false, [numQ]: 10 } },
    });
    expect(res.statusCode).toBe(202);
    expect((res.json() as { outcome: string }).outcome).toBe("disqualified");
  });

  it("404s an unknown lead", async () => {
    const { frameworkId } = await seedFrameworkWithIds();
    const res = await call("POST", `/v1/crm/leads/${randomUUID()}/qualify`, { payload: { frameworkId, answers: {} } });
    expect(res.statusCode).toBe(404);
  });

  it("404s an unknown framework", async () => {
    const leadId = await createLead("No Framework");
    const res = await call("POST", `/v1/crm/leads/${leadId}/qualify`, { payload: { frameworkId: randomUUID(), answers: {} } });
    expect(res.statusCode).toBe(404);
  });

  it("422s an inactive framework", async () => {
    const leadId = await createLead("Inactive FW Lead");
    const id = (await createFramework({ ...ENTERPRISE, active: false })).json().data.id;
    const res = await call("POST", `/v1/crm/leads/${leadId}/qualify`, { payload: { frameworkId: id, answers: {} } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FRAMEWORK_INACTIVE");
  });

  it("401 without token, 403 for a role with no CRM access", async () => {
    expect((await call("POST", `/v1/crm/leads/${randomUUID()}/qualify`, { noAuth: true, payload: { frameworkId: randomUUID(), answers: {} } })).statusCode).toBe(401);
    expect((await call("POST", `/v1/crm/leads/${randomUUID()}/qualify`, { headers: headers(["citizen"]), payload: { frameworkId: randomUUID(), answers: {} } })).statusCode).toBe(403);
  });
});
