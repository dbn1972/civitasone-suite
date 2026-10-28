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

describe("location-service: malformed JSON body -> 400 MALFORMED_BODY", () => {
  for (const [method, url] of [
  ["POST", "/v1/geofences"], ["POST", "/v1/jurisdictions"], ["POST", "/v1/locations"],
  ["POST", "/v1/locations/sample-data"], ["POST", "/v1/hierarchy"], ["POST", "/v1/pincodes/bulk-import"],
] as Probe[]) {
    it(`${method} ${url}`, async () => {
      const res = await app.inject({ method, url, headers: jsonHeaders, payload: "{not json" });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("MALFORMED_BODY");
    });
  }
});

describe("location-service: empty / invalid body -> 400 VALIDATION_FAILED", () => {
  for (const [method, url] of [
  ["POST", "/v1/geofences"], ["POST", "/v1/jurisdictions"],
  ["POST", "/v1/geofences/5e7c0000-0000-4000-8000-0000000000c1/check"],
  ["POST", "/v1/pincodes/bulk-import"],
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

describe("location-service: malformed id / bad query -> 400 VALIDATION_FAILED", () => {
  for (const url of [
  `/v1/geofences/${BAD}`, "/v1/geofences?limit=abc&offset=-5", `/v1/hierarchy/${BAD}`,
  `/v1/hierarchy/${BAD}/ancestors`, `/v1/hierarchy/${BAD}/children`, `/v1/hierarchy/${BAD}/descendants`,
  `/v1/hierarchy/postings/active/${BAD}`, `/v1/locations/cadastral/parcels/${BAD}`,
  `/v1/locations/road-network/segments/${BAD}`, `/v1/locations/road-network/segments/${BAD}/connected`,
  "/v1/locations/spatial/clusters?k=abc", "/v1/pincodes/search?q=",
] as string[]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});
