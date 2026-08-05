/**
 * CH-11 — Voice broadcast routes.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000110001";
const ACTOR = "cccccccc-3333-4000-8000-000000110001";
const CONTACT_1 = "dddddddd-4444-4000-8000-000000110001";
const CONTACT_2 = "dddddddd-4444-4000-8000-000000110002";

function headers(roles = ["telephony_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

let broadcastId: string;
let scheduledBroadcastId: string;

afterAll(async () => {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM telephony.broadcast_recipients WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM telephony.voice_broadcasts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
  await sqlClient.end();
});

describe("CH-11: Voice Broadcast", () => {
  it("create broadcast → 201", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/broadcasts",
      headers: headers(),
      payload: {
        name: "Welcome Campaign",
        ttsText: "Hello, welcome to our service!",
        recipientContactIds: [CONTACT_1, CONTACT_2],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.name).toBe("Welcome Campaign");
    expect(body.data.status).toBe("draft");
    expect(body.data.recipientCount).toBe(2);
    broadcastId = body.data.id;
  });

  it("create scheduled broadcast → 201 with status=scheduled", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/broadcasts",
      headers: headers(),
      payload: {
        name: "Scheduled Alert",
        ttsText: "Important announcement",
        scheduledAt: "2030-01-01T10:00:00.000Z",
        recipientContactIds: [CONTACT_1],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("scheduled");
    scheduledBroadcastId = res.json().data.id;
  });

  it("start with scheduled broadcast → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/broadcasts/${scheduledBroadcastId}/start`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("running");
  });

  it("start with non-scheduled (draft) broadcast → 422", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/broadcasts/${broadcastId}/start`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS");
  });

  it("list broadcasts → 200 with pagination", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/broadcasts",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it("get broadcast by id → 200 with recipients", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/broadcasts/${broadcastId}`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(broadcastId);
    expect(body.data.name).toBe("Welcome Campaign");
    expect(body.data.recipients).toBeDefined();
    expect(body.data.recipients.length).toBe(2);
  });

  it("get non-existent broadcast → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/broadcasts/00000000-0000-4000-8000-000000000000",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("cancel broadcast → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/broadcasts/${broadcastId}/cancel`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("cancelled");
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/broadcasts",
      payload: { name: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires admin role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/broadcasts",
      headers: headers(["employee"]),
      payload: { name: "Test", ttsText: "Hello" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
