/**
 * UAT API sweep 2026-10-29: malformed query / path ids / bodies / JSON must answer 4xx, never 5xx.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so the encapsulated route
 * contexts kept the Fastify default error handler and a thrown ZodError became a 500; per-module copies of the
 * handler also missed JSON parse errors.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b1";
const token = signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b1", tid: T, roles: ["super_admin"], sid: "sess-val" }, SECRET, 3600);
const headers = { authorization: `Bearer ${token}` };
const jsonHeaders = { ...headers, "content-type": "application/json" };
const BAD = "5e7c-not-a-uuid";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

type Probe = [method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string];
function is4xx(code: number): boolean { return code >= 400 && code < 500; }

describe("tenant-service: malformed JSON body -> 400 MALFORMED_BODY", () => {
  for (const [method, url] of [
  ["POST", "/v1/code-lists"], ["POST", "/v1/consent/requests"], ["POST", "/v1/consent/holdings"],
  ["POST", "/v1/consent/5e7c0000-0000-4000-8000-0000000000c1/grant"],
  ["POST", "/v1/data-governance/domains"], ["POST", "/v1/data-governance/assets"],
  ["POST", "/v1/org/hierarchy"], ["POST", "/v1/org/master-data/import"], ["POST", "/v1/org/migrations"],
  ["POST", "/v1/org/reconciliation"], ["POST", "/v1/positions"],
] as Probe[]) {
    it(`${method} ${url}`, async () => {
      const res = await app.inject({ method, url, headers: jsonHeaders, payload: "{not json" });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("MALFORMED_BODY");
    });
  }
});

describe("tenant-service: empty / invalid body -> 400 VALIDATION_FAILED", () => {
  for (const [method, url] of [
  ["POST", "/v1/plans"], ["POST", "/v1/quotas"], ["POST", "/v1/quotas/check"],   ["PUT", "/v1/settings"], ["POST", "/v1/subscriptions"],
  ["POST", "/v1/subscriptions/5e7c0000-0000-4000-8000-0000000000c1/cancel"],
  ["POST", "/v1/subscriptions/5e7c0000-0000-4000-8000-0000000000c1/renew"],
  ["POST", "/v1/subscriptions/5e7c0000-0000-4000-8000-0000000000c1/suspend"],
  ["POST", "/v1/subscriptions/5e7c0000-0000-4000-8000-0000000000c1/upgrade"],
] as Probe[]) {
    it(`${method} ${url} with {}`, async () => {
      const res = await app.inject({ method, url, headers: jsonHeaders, payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
    it(`${method} ${url} with wrong-typed fields`, async () => {
      const res = await app.inject({ method, url, headers: jsonHeaders, payload: { id: 1, name: [], code: {}, limit: "x" } });
      expect(is4xx(res.statusCode)).toBe(true);
    });
  }
});

describe("tenant-service: malformed id / bad query -> 400 VALIDATION_FAILED", () => {
  for (const url of [
  `/v1/plans/${BAD}`, `/v1/quotas/${BAD}`, `/v1/quotas/${BAD}/users`, `/v1/settings/tenant/${BAD}`,
  `/v1/subscriptions/${BAD}`, `/v1/quotas/5e7c0000-0000-4000-8000-0000000000c1/not-a-resource`,
] as string[]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("tenant-service: DELETE /v1/settings without a body -> 400", () => {
  it("is a validation error, not a 500", async () => {
    const res = await app.inject({ method: "DELETE", url: "/v1/settings", headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});

describe("tenant-service: POST /v1/plans with a valid body (BigInt price)", () => {
  it("answers 202 instead of 500 'Do not know how to serialize a BigInt'", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plans", headers: jsonHeaders,
      payload: { code: "uat-val-plan", name: "UAT validation plan", edition: "psu", maxUsers: 10, maxStorageGb: 5, priceMinor: 4999900, billingCycle: "monthly" },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    // the cache-primed plan is readable back without a BigInt serialisation failure
    const got = await app.inject({ method: "GET", url: `/v1/plans/${id}`, headers });
    expect(got.statusCode).toBe(200);
    expect(got.json().priceMinor).toBe("4999900");
  });
});

describe("tenant-service: POST /v1/quotas/increment (internal / platform_admin only) with an empty body", () => {
  it("is 400 VALIDATION_FAILED for platform_admin", async () => {
    const pa = signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b2", tid: T, roles: ["platform_admin"], sid: "sess-val-pa" }, SECRET, 3600);
    const res = await app.inject({ method: "POST", url: "/v1/quotas/increment", headers: { authorization: `Bearer ${pa}`, "content-type": "application/json" }, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
