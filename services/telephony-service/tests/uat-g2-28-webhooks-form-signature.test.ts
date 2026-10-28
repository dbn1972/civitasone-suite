/**
 * UAT G2 #28: carrier webhooks must (a) parse application/x-www-form-urlencoded (Twilio's format; it was a
 * blanket 415), and (b) stay protected by the carrier credential: unsigned / badly signed / wrongly tokened
 * requests are rejected 401 and publish nothing.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

// The webhook module reads these once at import time.
vi.hoisted(() => {
  process.env.TWILIO_AUTH_TOKEN = "uat_g2_28_twilio_token_0123456789";
  process.env.EXOTEL_WEBHOOK_TOKEN = "uat_g2_28_exotel_token_0123456789";
  process.env.CARRIER_WEBHOOK_BASE = "https://carrier.test.example";
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";

const TWILIO_TOKEN = "uat_g2_28_twilio_token_0123456789";
const EXOTEL_TOKEN = "uat_g2_28_exotel_token_0123456789";
const BASE = "https://carrier.test.example";
const FORM = "application/x-www-form-urlencoded";

function twilioSig(path: string, params: Record<string, string>, token = TWILIO_TOKEN): string {
  const data = BASE + path + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", token).update(data).digest("base64");
}
const encode = (p: Record<string, string>) => new URLSearchParams(p).toString();

let app: FastifyInstance;
let published: string[] = [];
beforeAll(async () => {
  app = await buildApp();
  const orig = queue.publish.bind(queue);
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, ...rest: never[]) => {
    published.push(topic);
    return orig(topic, ...rest);
  });
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

const INBOUND = "/v1/telephony/webhooks/twilio/inbound";
const STATUS = "/v1/telephony/webhooks/twilio/status";
const params = { CallSid: "CAuatg228", From: "+919876500011", To: "+918001112222", CallStatus: "ringing" };

describe("Twilio webhooks: form-urlencoded + signature enforcement", () => {
  it("accepts a correctly signed form-urlencoded inbound call (no 415) and answers TwiML", async () => {
    published = [];
    const res = await app.inject({
      method: "POST", url: INBOUND,
      headers: { "content-type": FORM, "x-twilio-signature": twilioSig(INBOUND, params) },
      payload: encode(params),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.body).toContain("<Response>");
    expect(published.length).toBeGreaterThan(0);
  });

  it("accepts a correctly signed status callback (204)", async () => {
    const p = { CallSid: "CAuatg228s", CallStatus: "ringing", To: "+918001112222" };
    const res = await app.inject({
      method: "POST", url: STATUS,
      headers: { "content-type": FORM, "x-twilio-signature": twilioSig(STATUS, p) },
      payload: encode(p),
    });
    expect(res.statusCode).toBe(204);
  });

  it("REJECTS an unsigned form body with 401 and publishes nothing", async () => {
    published = [];
    const res = await app.inject({ method: "POST", url: INBOUND, headers: { "content-type": FORM }, payload: encode(params) });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("WEBHOOK_UNAUTHORIZED");
    expect(published).toEqual([]);
  });

  it("REJECTS an invalid signature (garbage, wrong token, tampered body) with 401 and publishes nothing", async () => {
    published = [];
    const bad = [
      "bm90LWEtcmVhbC1zaWduYXR1cmU=",
      twilioSig(INBOUND, params, "some_other_token"),
      twilioSig(INBOUND, { ...params, From: "+910000000000" }),
    ];
    for (const sig of bad) {
      const res = await app.inject({ method: "POST", url: INBOUND, headers: { "content-type": FORM, "x-twilio-signature": sig }, payload: encode(params) });
      expect(res.statusCode).toBe(401);
    }
    expect(published).toEqual([]);
  });

  it("rejects unsigned requests on the status and recording callbacks too", async () => {
    for (const path of [STATUS, "/v1/telephony/webhooks/twilio/recording"]) {
      const res = await app.inject({ method: "POST", url: path, headers: { "content-type": FORM }, payload: encode(params) });
      expect(res.statusCode).toBe(401);
    }
  });

  it("does not add a form parser to non-webhook routes (still 415)", async () => {
    const token = signToken({ sub: "cccccccc-2828-4000-8000-0000000c0001", tid: "aaaaaaaa-2828-4000-8000-0000000a0001", roles: ["telephony_admin"], sid: "s" }, process.env.JWT_SECRET as string);
    const res = await app.inject({ method: "POST", url: "/v1/telephony/ivr-actions", headers: { "content-type": FORM, authorization: `Bearer ${token}` }, payload: "digit=1" });
    expect(res.statusCode).toBe(415);
  });
});

describe("Exotel webhooks: token enforcement", () => {
  const body = { CallSid: "EXuatg228", From: "+919876500011", To: "+918001112222", Status: "ringing" };

  it("accepts the configured token (inbound form body, status JSON body)", async () => {
    const a = await app.inject({
      method: "POST", url: "/v1/telephony/webhooks/exotel/inbound",
      headers: { "content-type": FORM, "x-exotel-token": EXOTEL_TOKEN }, payload: encode(body),
    });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({
      method: "POST", url: "/v1/telephony/webhooks/exotel/status",
      headers: { "content-type": "application/json", authorization: `Bearer ${EXOTEL_TOKEN}` }, payload: body,
    });
    expect(b.statusCode).toBe(204);
  });

  it("REJECTS missing or wrong tokens with 401 and publishes nothing", async () => {
    published = [];
    for (const url of ["/v1/telephony/webhooks/exotel/inbound", "/v1/telephony/webhooks/exotel/status"]) {
      const none = await app.inject({ method: "POST", url, headers: { "content-type": FORM }, payload: encode(body) });
      expect(none.statusCode).toBe(401);
      const wrong = await app.inject({ method: "POST", url, headers: { "content-type": FORM, "x-exotel-token": "wrong_token_wrong_token_wrong_" }, payload: encode(body) });
      expect(wrong.statusCode).toBe(401);
    }
    expect(published).toEqual([]);
  });
});
