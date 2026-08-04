/**
 * LQ-004 — lifecycle reason-code catalog admin + re-open transition with a
 * validated reason code (persisted on crm.lead_transitions.reason_code).
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
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-rc" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}
async function call(method: "GET" | "POST" | "PUT", url: string, opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {}) {
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
async function seedContact(id: string, leadStatus: string, tenantId = TENANT): Promise<void> {
  await scoped(tenantId, (tx) => tx`
    INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
    VALUES (${id}, ${tenantId}, 'Reopen Lead', ${leadStatus}, 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
    ON CONFLICT (id) DO UPDATE SET lead_status = ${leadStatus}
  `);
}
async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_transitions WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_reason_codes WHERE tenant_id = ${t}`);
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

describe("GET/PUT /v1/crm/lead-reason-codes", () => {
  it("seeds default codes on first read", async () => {
    const res = await call("GET", "/v1/crm/lead-reason-codes", { headers: headers(["crm_admin"], OTHER) });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { data: Array<{ code: string; appliesToStatus: string }> }).data;
    expect(codes.some((c) => c.code === "duplicate" && c.appliesToStatus === "disqualified")).toBe(true);
    expect(codes.some((c) => c.appliesToStatus === "nurture")).toBe(true);
  });

  it("upserts a custom code and reflects it on read (durable)", async () => {
    const put = await call("PUT", "/v1/crm/lead-reason-codes", {
      payload: { codes: [{ code: "lost_to_competitor", label: "Lost to competitor", appliesToStatus: "disqualified", active: true }] },
    });
    expect(put.statusCode).toBe(200);
    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT code FROM crm.lead_reason_codes WHERE tenant_id = ${TENANT} AND code = 'lost_to_competitor'
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
  });

  it("401 without token; 403 for non-admin on PUT; read allowed for crm_user", async () => {
    expect((await call("GET", "/v1/crm/lead-reason-codes", { noAuth: true })).statusCode).toBe(401);
    expect((await call("GET", "/v1/crm/lead-reason-codes", { headers: headers(["crm_user"]) })).statusCode).toBe(200);
    expect((await call("PUT", "/v1/crm/lead-reason-codes", { headers: headers(["crm_user"]), payload: { codes: [{ code: "x", label: "X", appliesToStatus: "nurture", active: true }] } })).statusCode).toBe(403);
  });

  it("400 for an invalid code body", async () => {
    expect((await call("PUT", "/v1/crm/lead-reason-codes", { payload: { codes: [{ code: "BAD CODE", label: "x", appliesToStatus: "nurture", active: true }] } })).statusCode).toBe(400);
  });
});

describe("re-open transition (LQ-004)", () => {
  it("re-opens a disqualified lead to qualified with a valid reason code (round-trip)", async () => {
    const id = randomUUID();
    await seedContact(id, "disqualified");
    const res = await call("POST", `/v1/crm/leads/${id}/transition`, {
      payload: { targetStatus: "qualified", reasonCode: "reopened_qualified", reason: "New RFP published" },
    });
    expect(res.statusCode).toBe(202);

    const contacts = (await scoped(TENANT, (tx) => tx`
      SELECT lead_status AS "leadStatus" FROM crm.contacts WHERE id = ${id} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(contacts[0]!.leadStatus).toBe("qualified");

    const transitions = (await scoped(TENANT, (tx) => tx`
      SELECT from_status AS "fromStatus", to_status AS "toStatus", reason_code AS "reasonCode", reason
      FROM crm.lead_transitions WHERE contact_id = ${id} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.fromStatus).toBe("disqualified");
    expect(transitions[0]!.toStatus).toBe("qualified");
    expect(transitions[0]!.reasonCode).toBe("reopened_qualified");
    expect(transitions[0]!.reason).toBe("New RFP published");
  });

  it("re-opens a disqualified lead to new with a valid reason code", async () => {
    const id = randomUUID();
    await seedContact(id, "disqualified");
    const res = await call("POST", `/v1/crm/leads/${id}/transition`, {
      payload: { targetStatus: "new", reasonCode: "reopened_new_info" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400s a re-open with no reason code", async () => {
    const id = randomUUID();
    await seedContact(id, "disqualified");
    const res = await call("POST", `/v1/crm/leads/${id}/transition`, { payload: { targetStatus: "qualified" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("REASON_CODE_REQUIRED");
  });

  it("422s a re-open with a reason code that does not apply to the target status", async () => {
    const id = randomUUID();
    await seedContact(id, "disqualified");
    // 'duplicate' applies to disqualified, not to qualified.
    const res = await call("POST", `/v1/crm/leads/${id}/transition`, { payload: { targetStatus: "qualified", reasonCode: "duplicate" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_REASON_CODE");
  });
});
