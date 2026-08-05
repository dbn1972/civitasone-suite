/**
 * Gap 2 — Campaign approval workflow route tests.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000ca00a001";
const ACTOR = "cccccccc-3333-4000-8000-0000ca00a001";
const CAMPAIGN_ID = "99999999-dddd-4000-8000-0000ca00a002";
const TEMPLATE_ID = "88888888-cccc-4000-8000-0000ca00a003";
const CONTACT_IDS = ["11111111-aaaa-4000-8000-0000ca00a004", "22222222-bbbb-4000-8000-0000ca00a005"];

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.pending_campaigns WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

async function seedPendingCampaign() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`INSERT INTO crm.pending_campaigns (id, tenant_id, channel, template_id, contact_ids, variables, created_by)
      VALUES (${CAMPAIGN_ID}, ${TENANT}, 'email', ${TEMPLATE_ID},
              ${JSON.stringify(CONTACT_IDS)}::jsonb, '{}'::jsonb, ${ACTOR})
      ON CONFLICT (id) DO NOTHING`;
  });
}

beforeAll(async () => {
  await cleanup();
  await seedPendingCampaign();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("Gap 2: campaign approval workflow", () => {
  it("approves a pending campaign (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/communications/campaigns/${CAMPAIGN_ID}/approve`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
  });

  it("rejects a pending campaign (202)", async () => {
    // Re-seed since previous test may have changed status
    await cleanup();
    await seedPendingCampaign();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/communications/campaigns/${CAMPAIGN_ID}/reject`,
      headers: headers(),
      payload: { reason: "Incorrect template used" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
  });

  it("returns 404 for non-existent campaign", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/campaigns/00000000-0000-4000-8000-000000000000/approve",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/communications/campaigns/${CAMPAIGN_ID}/approve`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires admin role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/communications/campaigns/${CAMPAIGN_ID}/approve`,
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
