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

  // GAP-CRM-LINKED-ACCOUNTS-01 (DPDP, fail-closed). A linked account is created
  // by typing an email address only — there is no OAuth/consent exchange — so it
  // stays 'pending'. Until ownership is verified (status flips to 'connected' via
  // a provider consent flow this service does not yet implement), NOTHING may be
  // synced into CRM against it; otherwise any CRM user could ingest a third
  // party's mailbox metadata just by typing their address. Enforced server-side.
  it("refuses to sync any external item into a PENDING (unconsented) linked account", async () => {
    const res = await inject("POST", "/v1/crm/synced-items", {
      linkedAccountId: linkedId, kind: "email", externalId: "msg-abc-1", subjectType: "contact", subjectId: SUBJECT,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LINKED_ACCOUNT_NOT_CONSENTED");
    // ...and crucially, nothing was ingested.
    const items = (await inject("GET", `/v1/crm/synced-items?subjectType=contact&subjectId=${SUBJECT}`)).json();
    expect(items.data.length).toBe(0);
  });

  // The DB trigger (migration 0095) is the backstop below the route: even a
  // direct write (consumer, future connector, ad-hoc SQL) cannot attach an item
  // to a non-connected account. This asserts the invariant at the storage layer.
  it("the DB itself rejects a synced item for a pending account (defense in depth)", async () => {
    await expect(
      sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        await tx`
          INSERT INTO crm.synced_items (tenant_id, linked_account_id, kind, external_id, subject_type, subject_id, created_by)
          VALUES (${TENANT}, ${linkedId}, 'email', 'direct-write-1', 'contact', ${SUBJECT}, ${ACTOR})
        `;
      }),
    ).rejects.toThrow(/not connected|verified ownership/i);
  });

  it("allows syncing once ownership is verified (account connected via consent)", async () => {
    // Simulate the deferred OAuth/consent flow completing: the account becomes
    // 'connected'. Only then may items sync.
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`UPDATE crm.linked_accounts SET status = 'connected' WHERE id = ${linkedId} AND tenant_id = ${TENANT}`;
    });

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
