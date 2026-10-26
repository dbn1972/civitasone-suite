/**
 * V4-B-10 — queue-service ops endpoints must verify credentials, not merely
 * check that an Authorization / x-internal header is present.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-0000000000b1";
const PATHS = ["/v1/queue/status", "/v1/queue/drivers", "/v1/queue/ops"];

describe("V4-B-10 queue ops auth", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  for (const url of PATHS) {
    it(`${url}: garbage bearer is rejected (401)`, async () => {
      const res = await app.inject({ method: "GET", url, headers: { authorization: "Bearer not-a-real-token" } });
      expect(res.statusCode).toBe(401);
    });

    it(`${url}: x-internal without the service secret is rejected (401)`, async () => {
      const res = await app.inject({ method: "GET", url, headers: { "x-internal": "1" } });
      expect(res.statusCode).toBe(401);
      const res2 = await app.inject({ method: "GET", url, headers: { "x-internal": "1", "x-tenant-id": TENANT } });
      expect(res2.statusCode).toBe(401);
    });

    it(`${url}: a valid signed token is accepted (200)`, async () => {
      const tok = signToken({ sub: "ops-user", tid: TENANT, roles: ["super_admin"], sid: "s-b10" }, SECRET, 3600);
      const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok}` } });
      expect(res.statusCode).toBe(200);
    });
  }
});
