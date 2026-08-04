/**
 * AC-004 email/calendar linking SUBSTRATE (framework). HTTP -> consumer -> DB
 * round-trips: connect (status=pending), link a synced item, list, disconnect.
 * NOTE: no live OAuth/IMAP/CalDAV is exercised because none is implemented (deferred).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000ac004";
const ACTOR = "cccccccc-3333-4000-8000-0000000ac004";
const SUBJECT = "22222222-bbbb-4000-8000-0000000ac004";

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "x-tenant-id": TENANT };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.synced_items WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.linked_accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => { await cleanup(); registerAllConsumers(queue); await queue.start(); });
afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function inject(method: string, url: string, payload?: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method: method as "GET", url, headers: headers(), ...(payload ? { payload } : {}) });
  await app.close();
  await drainQueue();
  return res;
}

describe("AC-004 linked accounts + synced items (framework)", () => {
  let linkedId = "";

  it("connects a mailbox as status=pending (no live OAuth)", async () => {
    const res = await inject("POST", "/v1/crm/linked-accounts", { provider: "google", externalEmail: "rep@example.gov.in", scopes: ["gmail.readonly"] });
    expect(res.statusCode).toBe(202);
    const list = (await inject("GET", "/v1/crm/linked-accounts")).json();
    expect(list.meta.liveSyncDeferred).toBe(true);
    expect(list.data.length).toBe(1);
    expect(list.data[0].status).toBe("pending");
    linkedId = list.data[0].id;
  });

  it("links an external email to a contact record", async () => {
    const res = await inject("POST", "/v1/crm/synced-items", {
      linkedAccountId: linkedId, kind: "email", externalId: "msg-abc-1", subjectType: "contact", subjectId: SUBJECT,
    });
    expect(res.statusCode).toBe(202);
    const items = (await inject("GET", `/v1/crm/synced-items?subjectType=contact&subjectId=${SUBJECT}`)).json();
    expect(items.data.length).toBe(1);
    expect(items.data[0].externalId).toBe("msg-abc-1");
  });

  it("404s linking to a missing linked account", async () => {
    const res = await inject("POST", "/v1/crm/synced-items", {
      linkedAccountId: "ffffffff-ffff-4000-8000-ffffffffffff", kind: "meeting", externalId: "x", subjectType: "contact", subjectId: SUBJECT,
    });
    expect(res.statusCode).toBe(404);
  });

  it("disconnecting removes the link and its synced items", async () => {
    const res = await inject("DELETE", `/v1/crm/linked-accounts/${linkedId}`);
    expect(res.statusCode).toBe(202);
    expect((await inject("GET", "/v1/crm/linked-accounts")).json().data.length).toBe(0);
    expect((await inject("GET", `/v1/crm/synced-items?subjectType=contact&subjectId=${SUBJECT}`)).json().data.length).toBe(0);
  });

  it("rejects an invalid provider (400)", async () => {
    const res = await inject("POST", "/v1/crm/linked-accounts", { provider: "aol", externalEmail: "x@example.com" });
    expect(res.statusCode).toBe(400);
  });
});
