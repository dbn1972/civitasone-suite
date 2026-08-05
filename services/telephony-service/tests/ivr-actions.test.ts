/**
 * Gaps 6 & 7 — IVR action handler route tests.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000ace001";
const ACTOR = "cccccccc-3333-4000-8000-000000ace001";
const CALL_ID = "dddddddd-4444-4000-8000-000000ace002";

function headers(roles = ["telephony_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

afterAll(async () => { await sqlClient.end(); });

describe("Gaps 6 & 7: IVR actions", () => {
  it("configures an IVR action (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/ivr-actions",
      headers: headers(),
      payload: { digit: "1", action: "create_lead", leadSource: "ivr_callback" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.action).toBe("create_lead");
  });

  it("triggers IVR action for create_lead (202) — Gap 6", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/ivr-actions/trigger",
      headers: headers(["telephony_user"]),
      payload: {
        callId: CALL_ID,
        callerId: "caller-123",
        callerNumber: "+919876543210",
        ivrSelection: "1",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().actionsTriggered).toBe(1);
  });

  it("triggers IVR action for send_sms (202) — Gap 7", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/ivr-actions/trigger",
      headers: headers(["telephony_user"]),
      payload: {
        callId: CALL_ID,
        callerId: "caller-456",
        callerNumber: "+919876543211",
        ivrSelection: "2",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().actionsTriggered).toBe(1);
  });

  it("returns 404 for unconfigured digit", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/ivr-actions/trigger",
      headers: headers(["telephony_user"]),
      payload: {
        callId: CALL_ID,
        callerId: "caller-789",
        callerNumber: "+919876543212",
        ivrSelection: "9",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/ivr-actions",
      payload: { digit: "1", action: "create_lead" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires admin role for config (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/ivr-actions",
      headers: headers(["employee"]),
      payload: { digit: "1", action: "create_lead" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
