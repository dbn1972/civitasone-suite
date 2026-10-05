/**
 * GAP-CRM-ACCOUNTS-DETAIL-06 — GET /v1/crm/contacts?accountId=<id> filters the
 * contacts list to a single owning account, so the account detail page's
 * "View contacts" link resolves by id (surviving renames and never mixing
 * similarly-named organisations) rather than a free-text name search.
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

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-acct-filter" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(method: "GET" | "POST", url: string, payload?: unknown) {
  const app = await buildApp();
  const res = await app.inject({
    method, url, headers: headers(),
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
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`;
  });
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

describe("GET /v1/crm/contacts?accountId filter (GAP-CRM-ACCOUNTS-DETAIL-06)", () => {
  it("returns only contacts owned by the given account", async () => {
    const acc = await call("POST", "/v1/crm/accounts", { name: "Directorate of Industries" });
    expect(acc.statusCode).toBe(202);
    const accountId = (acc.json() as { id: string }).id;

    const linked = await call("POST", "/v1/crm/contacts", { name: "Linked Contact", accountId });
    expect(linked.statusCode).toBe(202);
    const linkedId = (linked.json() as { id: string }).id;

    const unlinked = await call("POST", "/v1/crm/contacts", { name: "Unlinked Contact" });
    expect(unlinked.statusCode).toBe(202);

    const filtered = await call("GET", `/v1/crm/contacts?accountId=${accountId}`);
    expect(filtered.statusCode).toBe(200);
    const rows = (filtered.json() as { data: Array<{ id: string; name: string }> }).data;
    expect(rows.map((r) => r.id)).toContain(linkedId);
    expect(rows.every((r) => r.id === linkedId)).toBe(true);
  });

  it("rejects a non-uuid accountId with 400", async () => {
    const res = await call("GET", "/v1/crm/contacts?accountId=not-a-uuid");
    expect(res.statusCode).toBe(400);
  });
});
