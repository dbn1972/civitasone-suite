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

  it("seeds at least one active default code for every governed target status (LQ-004)", async () => {
    // Fresh tenant so seeding is exercised from empty.
    const t = randomUUID();
    const res = await call("GET", "/v1/crm/lead-reason-codes", { headers: headers(["crm_admin"], t) });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { data: Array<{ appliesToStatus: string; active: boolean }> }).data;
    for (const status of ["nurture", "recycled", "disqualified", "new", "qualified"]) {
      expect(
        codes.some((c) => c.appliesToStatus === status && c.active),
        `governed status '${status}' must have >=1 active default code so the picker is never empty`,
      ).toBe(true);
    }
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_reason_codes WHERE tenant_id = ${t}`);
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

// ── GAP-CRM-LEAD-REASON-CODES-04: list-level optimistic concurrency ──────────
describe("optimistic concurrency (GAP-CRM-LEAD-REASON-CODES-04)", () => {
  it("GET returns a list-level version + last-changed metadata", async () => {
    const t = randomUUID();
    const res = await call("GET", "/v1/crm/lead-reason-codes", { headers: headers(["crm_admin"], t) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version: string; meta: { updatedBy: string | null; updatedAt: string | null } };
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(res.headers.etag).toBe(body.version);
    expect(body.meta.updatedBy).toBeTruthy();
    expect(body.meta.updatedAt).toBeTruthy();
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_reason_codes WHERE tenant_id = ${t}`);
  });

  it("two writers with the same version: the second gets 409 and there is no overwrite", async () => {
    const t = randomUUID();
    // Seed + load an initial version both writers share.
    const loaded = await call("GET", "/v1/crm/lead-reason-codes", { headers: headers(["crm_admin"], t) });
    const staleVersion = (loaded.json() as { version: string }).version;

    // Writer 1 toggles a known default code off, with the current version → wins.
    const w1 = await call("PUT", "/v1/crm/lead-reason-codes", {
      headers: headers(["crm_admin"], t),
      payload: { codes: [{ code: "duplicate", label: "Duplicate record", appliesToStatus: "disqualified", active: false }], version: staleVersion },
    });
    expect(w1.statusCode).toBe(200);
    expect((w1.json() as { version: string }).version).not.toBe(staleVersion);

    // Writer 2 submits a different value for the SAME code with the now-stale version → 409.
    const w2 = await call("PUT", "/v1/crm/lead-reason-codes", {
      headers: headers(["crm_admin"], t),
      payload: { codes: [{ code: "duplicate", label: "Duplicate record", appliesToStatus: "disqualified", active: true }], version: staleVersion },
    });
    expect(w2.statusCode).toBe(409);
    expect((w2.json() as { code: string }).code).toBe("VERSION_CONFLICT");

    // Writer 1's change (active=false) survived; writer 2 did NOT overwrite it back to active=true.
    const rows = (await scoped(t, (tx) => tx`
      SELECT active FROM crm.lead_reason_codes WHERE tenant_id = ${t} AND code = 'duplicate' AND applies_to_status = 'disqualified'
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.active).toBe(false);
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_reason_codes WHERE tenant_id = ${t}`);
  });

  it("a PUT with no version still succeeds (back-compat)", async () => {
    const t = randomUUID();
    await call("GET", "/v1/crm/lead-reason-codes", { headers: headers(["crm_admin"], t) });
    const res = await call("PUT", "/v1/crm/lead-reason-codes", {
      headers: headers(["crm_admin"], t),
      payload: { codes: [{ code: "custom_reason", label: "Custom", appliesToStatus: "nurture", active: true }] },
    });
    expect(res.statusCode).toBe(200);
    await scoped(t, (tx) => tx`DELETE FROM crm.lead_reason_codes WHERE tenant_id = ${t}`);
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
