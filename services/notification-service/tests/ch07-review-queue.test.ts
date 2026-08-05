/**
 * CH-07 — Review queue for unmatched/ambiguous inbound contacts.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000070001";
const ACTOR = "cccccccc-3333-4000-8000-000000070001";
const CONTACT_ID = "dddddddd-4444-4000-8000-000000070001";
const QUEUE_ITEM_ID = "eeeeeeee-5555-4000-8000-000000070001";
const QUEUE_ITEM_ID2 = "eeeeeeee-5555-4000-8000-000000070002";

function headers(roles = ["notification_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

beforeAll(async () => {
  // Seed review queue items (simulating unmatched inbound messages)
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO notification.inbound_review_queue (id, tenant_id, channel, sender_identifier, message_content, status)
      VALUES
        (${QUEUE_ITEM_ID}, ${TENANT}, 'whatsapp', '+919876543210', 'Hi I need help', 'pending'),
        (${QUEUE_ITEM_ID2}, ${TENANT}, 'sms', '+919876543211', 'Order status?', 'pending')
      ON CONFLICT (id) DO NOTHING
    `;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM notification.inbound_review_queue WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
  await sqlClient.end();
});

describe("CH-07: Inbound Review Queue", () => {
  it("unmatched inbound → item appears in review queue (GET list)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/inbox/review-queue?status=pending",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.meta.total).toBeGreaterThanOrEqual(2);
    const item = body.data.find((r: { id: string }) => r.id === QUEUE_ITEM_ID);
    expect(item).toBeDefined();
    expect(item.channel).toBe("whatsapp");
    expect(item.senderIdentifier).toBe("+919876543210");
    expect(item.status).toBe("pending");
  });

  it("link to contact → item resolved, status=linked", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/notifications/inbox/review-queue/${QUEUE_ITEM_ID}/link`,
      headers: headers(),
      payload: { contactId: CONTACT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe("linked");
    expect(body.data.linkedContactId).toBe(CONTACT_ID);
  });

  it("discard → status changes to discarded", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/notifications/inbox/review-queue/${QUEUE_ITEM_ID2}/discard`,
      headers: headers(),
      payload: { reason: "spam message" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe("discarded");
  });

  it("link already resolved item → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/notifications/inbox/review-queue/${QUEUE_ITEM_ID}/link`,
      headers: headers(),
      payload: { contactId: CONTACT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/inbox/review-queue",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires admin role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/inbox/review-queue",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
