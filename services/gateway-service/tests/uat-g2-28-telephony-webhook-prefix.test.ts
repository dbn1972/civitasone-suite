/**
 * UAT G2 #28: carrier (Twilio/Exotel) callbacks carry no bearer token, so the gateway must let
 * /api/v1/telephony/webhooks/* through to telephony-service (which verifies the carrier credential and
 * fails closed), while every other telephony route keeps its edge authentication.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let upstreamCalls: string[] = [];
let upstreamInit: RequestInit | undefined;

beforeEach(() => {
  upstreamCalls = [];
  upstreamInit = undefined;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    upstreamCalls.push(String(url));
    upstreamInit = init;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("telephony carrier webhook public prefix", () => {
  it("lets an anonymous carrier callback reach telephony-service", async () => {
    const app = await buildApp();
    for (const p of ["twilio/inbound", "twilio/status", "twilio/recording", "exotel/inbound", "exotel/status"]) {
      upstreamCalls = [];
      const res = await app.inject({ method: "POST", url: `/api/v1/telephony/webhooks/${p}`, payload: { CallSid: "CA1" } });
      expect(res.statusCode).not.toBe(401);
      expect(upstreamCalls.some((u) => u.includes(`/v1/telephony/webhooks/${p}`))).toBe(true);
    }
    await app.close();
  });

  it("still requires a token for every other telephony route (incl. look-alike prefixes)", async () => {
    const app = await buildApp();
    for (const url of [
      "/api/v1/telephony/calls",
      "/api/v1/telephony/ivr-actions",
      "/api/v1/telephony/recordings",
      "/api/v1/telephony/webhooksx/twilio/inbound",
      "/api/v1/telephony/x/webhooks/twilio/inbound",
    ]) {
      const res = await app.inject({ method: "POST", url, payload: {} });
      expect(res.statusCode).toBe(401);
    }
    expect(upstreamCalls).toHaveLength(0);
    await app.close();
  });

  it("forwards a form-urlencoded Twilio callback RAW with the signature header, dropping identity headers (no 415)", async () => {
    const app = await buildApp();
    const raw = "CallSid=CA1&From=%2B911234567890&To=%2B910000000000";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/telephony/webhooks/twilio/inbound",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "sig123",
        "x-tenant-id": "evil",
        "x-actor-id": "evil",
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(upstreamInit?.body).toBe(raw);
    const h = upstreamInit?.headers as Record<string, string>;
    expect(h["x-twilio-signature"]).toBe("sig123");
    expect(h["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(h["x-tenant-id"]).toBeUndefined();
    expect(h["x-actor-id"]).toBeUndefined();
    await app.close();
  });

  it("forwards the Exotel token header on a JSON callback", async () => {
    const app = await buildApp();
    const raw = '{ "CallSid" : "E1" }';
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/telephony/webhooks/exotel/status",
      headers: { "content-type": "application/json", "x-exotel-token": "tok" },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(upstreamInit?.body).toBe(raw);
    expect((upstreamInit?.headers as Record<string, string>)["x-exotel-token"]).toBe("tok");
    await app.close();
  });
});
