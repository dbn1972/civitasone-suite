/**
 * GET /v1/crm/accounts payload contract (P1-2).
 * The accounts screen and the hierarchy panel are built from this single
 * response, so it must carry parentId, website and the linked-contact count,
 * scoped to the caller's tenant.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000021";
const OTHER_TENANT = "aaaaaaaa-1111-4000-8000-000000000022";
const ACTOR = "cccccccc-3333-4000-8000-000000000021";

const HEAD_ID = "22222222-aaaa-4000-8000-000000000001";
const BRANCH_ID = "22222222-aaaa-4000-8000-000000000002";
const INACTIVE_ID = "22222222-aaaa-4000-8000-000000000003";
const FOREIGN_ID = "22222222-aaaa-4000-8000-000000000004";
const CONTACT_A = "33333333-aaaa-4000-8000-000000000001";
const CONTACT_B = "33333333-aaaa-4000-8000-000000000002";
const CONTACT_INACTIVE = "33333333-aaaa-4000-8000-000000000003";

type AccountPayload = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  parentId: string | null;
  contactCount: number;
};

function headers(roles = ["crm_user"], tenantId = TENANT) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-accounts-list" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

/** RLS is tenant-scoped per transaction, so each tenant is cleaned separately. */
async function cleanup(): Promise<void> {
  for (const tenant of [TENANT, OTHER_TENANT]) {
    await sqlClient
      .begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
        await tx`DELETE FROM crm.contacts WHERE tenant_id = ${tenant}`.catch(() => {});
        await tx`DELETE FROM crm.accounts WHERE tenant_id = ${tenant}`.catch(() => {});
      })
      .catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.accounts (id, tenant_id, name, industry, website, status, parent_id, created_by, updated_by)
      VALUES
        (${HEAD_ID}, ${TENANT}, 'Alpha Head Office', 'Government', 'https://alpha.gov.in', 'active', null, ${ACTOR}, ${ACTOR}),
        (${BRANCH_ID}, ${TENANT}, 'Beta Branch Office', 'Government', null, 'active', ${HEAD_ID}, ${ACTOR}, ${ACTOR}),
        (${INACTIVE_ID}, ${TENANT}, 'Zeta Closed Office', null, null, 'inactive', null, ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, account_id, status, created_by, updated_by)
      VALUES
        (${CONTACT_A}, ${TENANT}, 'Contact One', ${HEAD_ID}, 'active', ${ACTOR}, ${ACTOR}),
        (${CONTACT_B}, ${TENANT}, 'Contact Two', ${HEAD_ID}, 'active', ${ACTOR}, ${ACTOR}),
        (${CONTACT_INACTIVE}, ${TENANT}, 'Contact Gone', ${HEAD_ID}, 'inactive', ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });

  // Seeded under its own tenant GUC — RLS refuses a cross-tenant insert.
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${OTHER_TENANT}, true)`;
    await tx`
      INSERT INTO crm.accounts (id, tenant_id, name, status, created_by, updated_by)
      VALUES (${FOREIGN_ID}, ${OTHER_TENANT}, 'Other Tenant Office', 'active', ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET /v1/crm/accounts", () => {
  it("returns hierarchy and contact-count fields for active accounts only", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/accounts", headers: headers() });
    expect(res.statusCode).toBe(200);

    const rows = (res.json() as { data: AccountPayload[] }).data;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(HEAD_ID);
    expect(ids).toContain(BRANCH_ID);
    expect(ids).not.toContain(INACTIVE_ID);

    const head = rows.find((r) => r.id === HEAD_ID);
    expect(head).toMatchObject({
      name: "Alpha Head Office",
      industry: "Government",
      website: "https://alpha.gov.in",
      parentId: null,
    });
    // Only the two active contacts count — the inactive one is excluded.
    expect(head?.contactCount).toBe(2);

    const branch = rows.find((r) => r.id === BRANCH_ID);
    expect(branch?.parentId).toBe(HEAD_ID);
    expect(branch?.contactCount).toBe(0);

    await app.close();
  });

  it("never returns another tenant's accounts", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/accounts", headers: headers() });
    const rows = (res.json() as { data: AccountPayload[] }).data;
    expect(rows.map((r) => r.id)).not.toContain(FOREIGN_ID);
    await app.close();
  });

  it("rejects a caller without a CRM role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/accounts",
      headers: headers(["finance_user"]),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
