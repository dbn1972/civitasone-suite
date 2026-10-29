/**
 * UAT API sweep 2026-10-29 (FQ10b-1): malformed path ids / bodies must answer 400, never 500.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so every
 * encapsulated route context without a handler of its own kept Fastify's default handler and a
 * thrown ZodError became a 500.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b5";
const headers = {
  authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b5", tid: T, roles: ["super_admin", "citizen_admin"], sid: "sess-val" }, SECRET, 3600)}`,
};
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("malformed id path param -> 400, not a ZodError 500", () => {
  for (const url of [
    "/v1/citizen/packs/services/not-a-uuid",
    "/v1/citizen/catalogue/services/not-a-uuid/sandbox-test/runs",
    "/v1/citizen/catalogue/services/not-a-uuid/sandbox-test/latest",
  ]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("POST /v1/citizen/packs/services/export: empty / invalid / malformed body -> 400", () => {
  const url = "/v1/citizen/packs/services/export";
  it("{} names the missing definitionId", async () => {
    const res = await app.inject({ method: "POST", url, headers, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.json())).toContain("definitionId");
  });
  it("invalid fields", async () => {
    const res = await app.inject({ method: "POST", url, headers, payload: INVALID_FIELDS });
    expect(res.statusCode).toBe(400);
  });
  it("malformed JSON", async () => {
    const res = await app.inject({ method: "POST", url, headers: { ...headers, "content-type": "application/json" }, payload: "{not json" });
    expect(res.statusCode).toBe(400);
  });
});
