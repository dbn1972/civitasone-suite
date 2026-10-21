/**
 * GAP-CRM-HEALTH-ACCOUNTID-03 -- an account follow-up service request keeps the
 * account it is about.
 *
 * The Account Health "Create Follow-up" modal has always sent `relatedAccountId`,
 * but createBody stripped it and crm.service_requests had no column (migration
 * 0165 adds it), so the created record could not say which account it belonged
 * to. DB-backed HTTP round-trip; fails on the old code because the field was
 * dropped on write and absent on read.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// Set by vitest.config.ts (env.JWT_SECRET); no literal secret in the source.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(tid = TENANT, roles = ["crm_user"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-sr-acct" }, SECRET)}`,
    "x-tenant-id": tid,
  };
}

const app = await buildApp();

function scoped<T>(tid: string, fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function makeAccount(tid: string): Promise<string> {
  const id = randomUUID();
  await scoped(tid, async (tx) => {
    await tx`INSERT INTO crm.accounts (id, tenant_id, name, created_by, updated_by) VALUES (${id}, ${tid}, ${"Bharat Steel " + id}, ${ACTOR}, ${ACTOR})`;
  });
  return id;
}

afterAll(async () => {
  for (const tid of [TENANT, OTHER_TENANT]) {
    await scoped(tid, async (tx) => {
      await tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${tid}`.catch(() => {});
      await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${tid}`.catch(() => {});
      await tx`DELETE FROM crm.accounts WHERE tenant_id = ${tid}`.catch(() => {});
    }).catch(() => {});
  }
  await app.close();
  await sqlClient.end();
});

function createPayload(extra: Record<string, unknown> = {}) {
  return {
    citizenName: "Suresh Rao",
    serviceType: "Account Health Follow-up",
    subject: "Account health follow-up -- Bharat Steel Ltd",
    priority: "normal",
    ...extra,
  };
}

describe("service request relatedAccountId (GAP-CRM-HEALTH-ACCOUNTID-03)", () => {
  it("persists the related account and returns it on create and on the detail read", async () => {
    const accountId = await makeAccount(TENANT);
    const created = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: createPayload({ relatedAccountId: accountId }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.relatedAccountId).toBe(accountId);
    expect(created.json().data.serviceType).toBe("Account Health Follow-up");

    const detail = await app.inject({
      method: "GET",
      url: `/v1/crm/service-requests/${created.json().data.id as string}`,
      headers: headers(),
    });
    expect(detail.json().data.relatedAccountId).toBe(accountId);
  });

  it("records the related account id (and no citizen PII) on the created event", async () => {
    const accountId = await makeAccount(TENANT);
    const created = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: createPayload({ relatedAccountId: accountId, citizenPhone: "9876543210" }),
    });
    const id = created.json().data.id as string;
    // emitWithAudit enqueues the domain event (payload = the mutation payload) and the
    // audit.event.record in the same transaction as the insert.
    const rows = await scoped(TENANT, (tx) => tx<Array<{ event_type: string; payload: Record<string, unknown> }>>`
      SELECT event_type, payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT}
        AND (payload->>'serviceRequestId' = ${id} OR payload->>'resourceId' = ${id})
    `);
    const createdEvent = rows.find((r) => r.event_type === "crm.service_request.created");
    expect(createdEvent?.payload.relatedAccountId).toBe(accountId);
    expect(rows.some((r) => r.event_type === "audit.event.record")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("9876543210");
  });

  it("rejects an account id that does not exist in the caller's tenant (422, nothing stored)", async () => {
    const foreign = await makeAccount(OTHER_TENANT);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: createPayload({ relatedAccountId: foreign }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ACCOUNT_NOT_FOUND");
    const count = await scoped(TENANT, (tx) => tx<Array<{ n: number }>>`SELECT count(*)::int AS n FROM crm.service_requests WHERE tenant_id = ${TENANT} AND related_account_id = ${foreign}`);
    expect(count[0]!.n).toBe(0);
  });

  it("rejects an account that was merged away (inactive) with 422, nothing stored", async () => {
    // Accounts only go inactive through a merge. A new follow-up must not be linked to the
    // tombstoned duplicate: "View related account" would land on "Account not found".
    const merged = await makeAccount(TENANT);
    await scoped(TENANT, async (tx) => {
      await tx`UPDATE crm.accounts SET status = 'inactive' WHERE id = ${merged} AND tenant_id = ${TENANT}`;
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: createPayload({ relatedAccountId: merged }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ACCOUNT_NOT_FOUND");
    const count = await scoped(TENANT, (tx) => tx<Array<{ n: number }>>`SELECT count(*)::int AS n FROM crm.service_requests WHERE tenant_id = ${TENANT} AND related_account_id = ${merged}`);
    expect(count[0]!.n).toBe(0);
  });

  it("rejects a malformed account id with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: createPayload({ relatedAccountId: "not-a-uuid" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("leaves relatedAccountId null for an ordinary citizen request", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: { citizenName: "Asha Rao", serviceType: "Birth Certificate", subject: "Correction" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.relatedAccountId).toBeNull();
  });
});
