/**
 * DOM-015 — GET /v1/notification/channels/analytics/{summary,campaigns/:id}
 * must report real counts, not a hardcoded all-zero object.
 *
 * Before this fix both endpoints returned the exact same all-zero shape
 * regardless of what was actually in `deliveries.deliveries`,
 * `analytics.open_events` / `click_events`, `bulk.campaigns` /
 * `campaign_recipients`, `bounces.bounce_events`, or
 * `notification.conversations` — including for a campaign id that does not
 * exist at all. This seeds those tables directly (the same tables
 * `modules/deliveries/consumer.ts`'s `mirrorCampaignOutcome` and
 * `modules/analytics/consumer.ts` already write in production) against a
 * live, FORCE-RLS Postgres and asserts the routes now report exactly what was
 * seeded, plus a 404 for an unknown campaign.
 *
 * `bounce_events.recipient` is application-encrypted (`encryptedText`), so
 * that one row is seeded through drizzle (which knows how to encrypt it)
 * rather than raw SQL like everything else here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { bounceEvents } from "../src/modules/bounces/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddd0079-1111-4000-8000-000000000015";
const ACTOR = "dddd0079-1111-4000-8000-0000000000aa";

function authHeader(): Record<string, string> {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles: ["notification_admin"] }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

/** Domain tables have FORCE RLS; raw seeding must set the tenant GUC (matches campaign-marketing.test.ts). */
async function sqlAsTenant<T>(tenantId: string, fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlAsTenant(TENANT, async (sql) => {
    await sql`DELETE FROM bounces.bounce_events WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM analytics.click_events WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM analytics.open_events WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM bulk.campaign_recipients WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM bulk.campaigns WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM notification.conversations WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("GET /v1/notification/channels/analytics/summary (DOM-015)", () => {
  it("reports real seeded delivered/opened/clicked/bounced/campaign/conversation counts", async () => {
    const templateId = randomUUID();
    const deliveredId = randomUUID();

    await sqlAsTenant(TENANT, async (sql) => {
      await sql`INSERT INTO deliveries.deliveries (id, tenant_id, template_id, recipient, channel, status, created_by, updated_by)
                VALUES (${deliveredId}, ${TENANT}, ${templateId}, 'citizen@example.gov.in', 'email', 'delivered', ${ACTOR}, ${ACTOR})`;
      await sql`INSERT INTO analytics.open_events (tenant_id, delivery_id) VALUES (${TENANT}, ${deliveredId})`;
      await sql`INSERT INTO analytics.click_events (tenant_id, delivery_id, link_url) VALUES (${TENANT}, ${deliveredId}, 'https://example.gov.in/scheme')`;
      await sql`INSERT INTO bulk.campaigns (id, tenant_id, template_id, name, status, created_by, updated_by)
                VALUES (${randomUUID()}, ${TENANT}, ${templateId}, 'DOM-015 summary test campaign', 'sending', ${ACTOR}, ${ACTOR})`;
      await sql`INSERT INTO notification.conversations (tenant_id, channel, contact_id, created_by, updated_by)
                VALUES (${TENANT}, 'whatsapp', ${randomUUID()}, ${ACTOR}, ${ACTOR})`;
    });
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(bounceEvents).values({
        tenantId: TENANT, deliveryId: null, recipient: "bounced@example.gov.in",
        recipientHash: "test-hash-summary", classification: "hard",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));

    const res = await app.inject({
      method: "GET",
      url: "/v1/notification/channels/analytics/summary",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      totalDelivered: 1, opened: 1, clicked: 1, bounced: 1, campaignCount: 1, conversationCount: 1,
    });
  });
});

describe("GET /v1/notification/channels/analytics/campaigns/:id (DOM-015)", () => {
  it("reports real seeded recipient/delivery/event/bounce counts for an existing campaign", async () => {
    const campaignId = randomUUID();
    const templateId = randomUUID();
    const deliveredId = randomUUID();

    await sqlAsTenant(TENANT, async (sql) => {
      await sql`INSERT INTO bulk.campaigns (id, tenant_id, template_id, name, status, created_by, updated_by)
                VALUES (${campaignId}, ${TENANT}, ${templateId}, 'DOM-015 per-campaign test', 'sending', ${ACTOR}, ${ACTOR})`;
      await sql`INSERT INTO deliveries.deliveries (id, tenant_id, template_id, recipient, channel, status, created_by, updated_by)
                VALUES (${deliveredId}, ${TENANT}, ${templateId}, 'ok@example.gov.in', 'email', 'delivered', ${ACTOR}, ${ACTOR})`;
      await sql`INSERT INTO bulk.campaign_recipients (tenant_id, campaign_id, recipient_id, status, delivery_id, created_by, updated_by)
                VALUES (${TENANT}, ${campaignId}, 'ok@example.gov.in', 'delivered', ${deliveredId}, ${ACTOR}, ${ACTOR})`;
      await sql`INSERT INTO bulk.campaign_recipients (tenant_id, campaign_id, recipient_id, status, created_by, updated_by)
                VALUES (${TENANT}, ${campaignId}, 'nope@example.gov.in', 'failed', ${ACTOR}, ${ACTOR})`;
      await sql`INSERT INTO analytics.open_events (tenant_id, delivery_id) VALUES (${TENANT}, ${deliveredId})`;
    });
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(bounceEvents).values({
        tenantId: TENANT, deliveryId: deliveredId, recipient: "ok@example.gov.in",
        recipientHash: "test-hash-campaign", classification: "soft",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));

    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/channels/analytics/campaigns/${campaignId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      campaignId, totalDelivered: 1, opened: 1, clicked: 0, bounced: 1, failed: 1,
    });
  });

  it("404s for a campaign id that does not exist (never the old fabricated all-zero metrics)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/channels/analytics/campaigns/${randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });
});
