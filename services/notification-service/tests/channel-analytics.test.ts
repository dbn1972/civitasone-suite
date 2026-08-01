/**
 * CH-14: Campaign/Conversation Analytics Tests
 * GET /v1/notification/channels/analytics/summary
 * GET /v1/notification/channels/analytics/campaigns/:id
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000071";
const ACTOR = "cccccccc-3333-4000-8000-000000000071";
const CAMPAIGN_ID = "eeeeeeee-5555-4000-8000-000000000071";

function token(roles = ["notification_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-002" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/notification/channels/analytics/summary (CH-14)", () => {
  it("returns 200 with summary object", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/notification/channels/analytics/summary",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.totalDelivered).toBe("number");
    expect(typeof body.data.opened).toBe("number");
    expect(typeof body.data.clicked).toBe("number");
    expect(typeof body.data.bounced).toBe("number");
    expect(typeof body.data.campaignCount).toBe("number");
    expect(typeof body.data.conversationCount).toBe("number");
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/notification/channels/analytics/summary",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/notification/channels/analytics/summary",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns data for analytics_viewer role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/notification/channels/analytics/summary",
      headers: { authorization: `Bearer ${token(["analytics_viewer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
});

describe("GET /v1/notification/channels/analytics/campaigns/:id (CH-14)", () => {
  it("returns 200 with campaign metrics", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/channels/analytics/campaigns/${CAMPAIGN_ID}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.campaignId).toBe(CAMPAIGN_ID);
    expect(typeof body.data.totalDelivered).toBe("number");
    expect(typeof body.data.opened).toBe("number");
    expect(typeof body.data.clicked).toBe("number");
    expect(typeof body.data.bounced).toBe("number");
    expect(typeof body.data.failed).toBe("number");
  });

  it("returns 400 for invalid campaign id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/notification/channels/analytics/campaigns/not-a-uuid",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/channels/analytics/campaigns/${CAMPAIGN_ID}`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/channels/analytics/campaigns/${CAMPAIGN_ID}`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
