/**
 * UAT API sweep 2026-10-29 (FQ10b-1): invalid input must answer 4xx, never 5xx.
 * Root causes: registerSchemaErrorHandler ran AFTER the route plugins, so a ZodError thrown in a
 * module without its own handler became a 500 (gstin verify); module-local handlers mapped Fastify's
 * own 4xx (malformed JSON) to 500 (razorpay webhook); and PayU/CCAvenue callbacks that carry no
 * credential at all reached the "gateway not configured" check and answered 503.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b2";
const RND = "5e7c0000-0000-4000-8000-0000000000c2";
const headers = {
  authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b2", tid: T, roles: ["super_admin", "billing_admin", "finance_officer"], sid: "sess-val" }, SECRET, 3600)}`,
};
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

let app: FastifyInstance;
beforeAll(async () => {
  // The UAT stack runs with no gateway credentials; reproduce that state.
  for (const k of ["PAYU_MERCHANT_KEY", "PAYU_SALT", "CCAVENUE_WORKING_KEY"]) delete process.env[k];
  app = await buildApp();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GSTIN path param -> 400 VALIDATION_FAILED, not a ZodError 500", () => {
  for (const gstin of ["not-a-uuid", RND]) {
    it(`GET /v1/billing/gstn/gstin/${gstin}/verify`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/billing/gstn/gstin/${gstin}/verify`, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("malformed JSON on a webhook -> 400, not 500", () => {
  for (const hook of ["razorpay", "payu", "ccavenue"]) {
    it(`POST /v1/billing/webhooks/${hook} '{not json'`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/billing/webhooks/${hook}`, headers: { "content-type": "application/json" }, payload: "{not json" });
      expect(res.statusCode).toBe(400);
    });
  }
});

describe("PayU / CCAvenue callback without any credential -> 401 even while the gateway is unconfigured (was 503)", () => {
  for (const hook of ["payu", "ccavenue"]) {
    it(`POST /v1/billing/webhooks/${hook} no body`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/billing/webhooks/${hook}` });
      expect(res.statusCode).toBe(401);
    });
    it(`POST /v1/billing/webhooks/${hook} {}`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/billing/webhooks/${hook}`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
    it(`POST /v1/billing/webhooks/${hook} invalid fields`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/billing/webhooks/${hook}`, payload: INVALID_FIELDS });
      expect(res.statusCode).toBe(401);
    });
  }

  it("a PayU callback that DOES carry a hash still reaches the fail-closed credential check (503, never accepted)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/payu", payload: { hash: "abc", txnid: "t", status: "success" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("WEBHOOK_NOT_CONFIGURED");
  });
});

describe("bad query -> 400", () => {
  for (const url of ["/v1/billing/gstn/returns?limit=abc&offset=-5", "/v1/billing/gstn/returns/prepare?limit=abc&offset=-5"]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
    });
  }
});
