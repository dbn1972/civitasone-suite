/**
 * F5-01 / F5-02 — Account owner + "last contact" context.
 *
 * F5-01: POST /v1/crm/accounts accepts an optional ownerId and persists it;
 *   PATCH /v1/crm/accounts/:id changes the owner, bumps version and writes an
 *   update_account audit row (ids only, never a name); GET /v1/crm/accounts
 *   returns ownerId.
 * F5-02: creating an account-linked activity stamps the account's
 *   last_contact_at, which GET /v1/crm/accounts surfaces as `lastContactAt`
 *   WITHOUT a cross-module JOIN into crm.activities.
 *
 * Round-trips through the real route → bus → consumer path.
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
const ACTOR = randomUUID();
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-f5-owner" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, hdrs = headers()) {
  const app = await buildApp();
  const res = await app.inject({
    method, url, headers: hdrs,
    ...(payload === undefined ? {} : { payload }),
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

async function cleanup(): Promise<void> {
  await scoped(TENANT, async (tx) => {
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
}

type AccountRow = {
  id: string;
  name: string;
  ownerId: string | null;
  lastContactAt: string | null;
  contactCount: number;
  version?: number;
};

async function listAccounts(): Promise<AccountRow[]> {
  const res = await call("GET", "/v1/crm/accounts");
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: AccountRow[] }).data;
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
  // OWNER_B is a member of the tenant's CRM agent directory; OWNER_A is not.
  await scoped(TENANT, async (tx) => {
    await tx`INSERT INTO crm.agent_workload (tenant_id, agent_id) VALUES (${TENANT}, ${OWNER_B})`;
  });
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("F5-01 account owner", () => {
  it("persists and returns ownerId supplied at create", async () => {
    const created = await call("POST", "/v1/crm/accounts", { name: "Owned Directorate", ownerId: OWNER_A });
    expect(created.statusCode).toBe(202);
    const id = (created.json() as { id: string }).id;

    const rows = await listAccounts();
    const row = rows.find((r) => r.id === id);
    expect(row, "created account should be listed").toBeDefined();
    expect(row?.ownerId).toBe(OWNER_A);
  });

  it("PATCH changes the owner, bumps version and audits ids only (no name)", async () => {
    const created = await call("POST", "/v1/crm/accounts", { name: "Reassignable Office", ownerId: OWNER_A });
    const id = (created.json() as { id: string }).id;
    await drainQueue();

    const patched = await call("PATCH", `/v1/crm/accounts/${id}`, { ownerId: OWNER_B });
    expect(patched.statusCode).toBe(202);

    // The persisted owner changed and the version bumped past the initial 1.
    const row = await scoped(TENANT, async (tx) =>
      (await tx<Array<{ ownerId: string | null; version: number }>>`
        SELECT owner_id AS "ownerId", version FROM crm.accounts
        WHERE id = ${id} AND tenant_id = ${TENANT}
      `)[0],
    );
    expect(row?.ownerId).toBe(OWNER_B);
    expect(row?.version).toBeGreaterThan(1);

    // Audit row for update_account exists and carries ids only — crucially,
    // it does NOT echo the account NAME anywhere in the payload.
    const audits = await sqlClient<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
    `;
    const updateAudit = audits.find(
      (a) => (a.payload as { action?: string }).action === "update_account"
        && (a.payload as { resourceId?: string }).resourceId === id,
    );
    expect(updateAudit, "expected an update_account audit row").toBeDefined();
    expect(JSON.stringify(updateAudit?.payload)).not.toContain("Reassignable Office");
  });

  it("PATCH refuses an owner who is not in this tenant's agent directory -> 422", async () => {
    const created = await call("POST", "/v1/crm/accounts", { name: "Guarded Office", ownerId: OWNER_B });
    const id = (created.json() as { id: string }).id;
    await drainQueue();
    const res = await call("PATCH", `/v1/crm/accounts/${id}`, { ownerId: randomUUID() });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("OWNER_NOT_IN_TENANT");
    const row = await scoped(TENANT, async (tx) =>
      (await tx<Array<{ ownerId: string | null }>>`SELECT owner_id AS "ownerId" FROM crm.accounts WHERE id = ${id}`)[0],
    );
    expect(row?.ownerId).toBe(OWNER_B);
  });

  it("PATCH is restricted to managers/admins: a plain crm_user gets 403", async () => {
    const created = await call("POST", "/v1/crm/accounts", { name: "Role Gated Office", ownerId: OWNER_B });
    const id = (created.json() as { id: string }).id;
    await drainQueue();
    const res = await call("PATCH", `/v1/crm/accounts/${id}`, { ownerId: OWNER_B }, headers(["crm_user"]));
    expect(res.statusCode).toBe(403);
  });

  it("rejects a non-uuid ownerId at the boundary with 400", async () => {
    const res = await call("POST", "/v1/crm/accounts", { name: "Bad Owner", ownerId: "not-a-uuid" });
    expect(res.statusCode).toBe(400);
  });
});

describe("F5-02 account last contact", () => {
  it("stamps lastContactAt when an activity is linked to the account", async () => {
    const created = await call("POST", "/v1/crm/accounts", { name: "Active Account", ownerId: OWNER_A });
    const accountId = (created.json() as { id: string }).id;
    await drainQueue();

    // Before any activity, lastContactAt is null.
    let row = (await listAccounts()).find((r) => r.id === accountId);
    expect(row?.lastContactAt ?? null).toBeNull();

    const activity = await call("POST", "/v1/crm/activities", {
      accountId,
      type: "call",
      text: "Spoke with the directorate about renewal.",
    });
    expect([202, 200]).toContain(activity.statusCode);
    await drainQueue();

    row = (await listAccounts()).find((r) => r.id === accountId);
    expect(row?.lastContactAt, "lastContactAt should be set after a linked activity").toBeTruthy();
    expect(Number.isNaN(Date.parse(row?.lastContactAt ?? "x"))).toBe(false);
  });
});
