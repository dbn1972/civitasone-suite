/**
 * W2 crm cluster 07 -- GAP-CRM-LINKED-ACCOUNTS-01 (caller scoping).
 *
 * A linked mailbox/calendar is one user's personal data. Listing, disconnecting and
 * attaching synced items are limited to the account's registering user; only an admin
 * keeps tenant-wide visibility. Another user's account is reported as 404 (never 403)
 * so its id cannot be probed. (The OAuth/consent flow that would flip an account to
 * `connected` is an owner decision and is NOT built -- see the gap ledger.)
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();
const ADMIN = randomUUID();
const SUBJECT = randomUUID();

function headers(sub: string, roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-w2c7" }, SECRET)}`, "x-tenant-id": TENANT };
}
const asA = () => headers(USER_A, ["crm_user"]);
const asB = () => headers(USER_B, ["crm_user"]);
const asAdmin = () => headers(ADMIN, ["crm_admin"]);

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.synced_items WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.linked_accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => { await cleanup(); registerAllConsumers(queue); await queue.start(); });
afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function inject(method: string, url: string, hdrs: Record<string, string>, payload?: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method: method as "GET", url, headers: hdrs, ...(payload ? { payload } : {}) });
  await app.close();
  await drainQueue();
  return res;
}

describe("linked accounts are scoped to the user who registered them", () => {
  let aId = "";

  it("each user lists only their own linked accounts", async () => {
    expect((await inject("POST", "/v1/crm/linked-accounts", asA(), { provider: "google", externalEmail: "a@example.gov.in" })).statusCode).toBe(202);
    expect((await inject("POST", "/v1/crm/linked-accounts", asB(), { provider: "o365", externalEmail: "b@example.gov.in" })).statusCode).toBe(202);

    const listA = (await inject("GET", "/v1/crm/linked-accounts", asA())).json() as { data: Array<{ id: string; externalEmail: string; userId: string }> };
    expect(listA.data.map((r) => r.externalEmail)).toEqual(["a@example.gov.in"]);
    expect(listA.data[0]!.userId).toBe(USER_A);
    aId = listA.data[0]!.id;

    const listB = (await inject("GET", "/v1/crm/linked-accounts", asB())).json() as { data: Array<{ externalEmail: string }> };
    expect(listB.data.map((r) => r.externalEmail)).toEqual(["b@example.gov.in"]);
  });

  it("an admin keeps tenant-wide visibility (to find and revoke an offboarded user's link)", async () => {
    const list = (await inject("GET", "/v1/crm/linked-accounts", asAdmin())).json() as { data: Array<{ externalEmail: string }>; meta: { total: number } };
    expect(list.meta.total).toBe(2);
    expect(list.data.map((r) => r.externalEmail).sort()).toEqual(["a@example.gov.in", "b@example.gov.in"]);
  });

  it("another user cannot disconnect it: 404, and the account survives", async () => {
    const res = await inject("DELETE", `/v1/crm/linked-accounts/${aId}`, asB());
    expect(res.statusCode).toBe(404);
    const list = (await inject("GET", "/v1/crm/linked-accounts", asA())).json() as { data: unknown[] };
    expect(list.data).toHaveLength(1);
  });

  it("another user cannot attach synced items to it: 404", async () => {
    const res = await inject("POST", "/v1/crm/synced-items", asB(), {
      linkedAccountId: aId, kind: "email", externalId: "msg-b-1", subjectType: "contact", subjectId: SUBJECT,
    });
    expect(res.statusCode).toBe(404);
  });

  it("the owner can still use it: a pending account is refused for consent, not for ownership (409)", async () => {
    const res = await inject("POST", "/v1/crm/synced-items", asA(), {
      linkedAccountId: aId, kind: "email", externalId: "msg-a-1", subjectType: "contact", subjectId: SUBJECT,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LINKED_ACCOUNT_NOT_CONSENTED");
  });

  it("the owner can disconnect their own account", async () => {
    expect((await inject("DELETE", `/v1/crm/linked-accounts/${aId}`, asA())).statusCode).toBe(202);
    const list = (await inject("GET", "/v1/crm/linked-accounts", asA())).json() as { data: unknown[] };
    expect(list.data).toHaveLength(0);
  });
});
