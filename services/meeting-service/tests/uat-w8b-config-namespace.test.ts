/**
 * UAT W8-B (meeting-service), driven against a real Postgres.
 *
 *  5xx  GET /v1/meetings/config/:namespace 500'd for any namespace outside NAMESPACE_PATTERN (the domain
 *       assert threw a plain Error); now 400. Same for /v1/meetings/config-entry's namespace/key.
 *       Same root cause and fix as court / visitor config-registry.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const bearer = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin", "super_admin"], sid: "s-w8b" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("UAT W8-B 5xx: GET /v1/meetings/config/:namespace", () => {
  it.each(["not-a-namespace", "ABC", "1abc", "a.b", "x", "a".repeat(80), randomUUID()])("invalid namespace %s -> 400, not 500", async (ns) => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/config/${encodeURIComponent(ns)}`, headers: bearer() });
    expect(res.statusCode).toBe(400);
  });

  it("a valid but empty namespace -> 200 with no items", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/config/w8b_empty", headers: bearer() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], count: 0 });
  });

  it("config-entry with a bad namespace or key -> 400; a valid unknown key -> 404", async () => {
    for (const q of ["namespace=Bad-NS&key=k", "namespace=meeting_policy&key=-bad", "namespace=meeting_policy", ""]) {
      const res = await app.inject({ method: "GET", url: `/v1/meetings/config-entry?${q}`, headers: bearer() });
      expect(res.statusCode, q).toBe(400);
    }
    const res = await app.inject({ method: "GET", url: "/v1/meetings/config-entry?namespace=meeting_policy&key=w8b.unknown", headers: bearer() });
    expect(res.statusCode).toBe(404);
  });
});
